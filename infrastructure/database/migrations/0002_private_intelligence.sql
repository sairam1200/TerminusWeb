BEGIN;

-- Explicit private-host migration. Never run on Vercel or automatically at startup.
CREATE SCHEMA terminus_intelligence;
REVOKE ALL ON SCHEMA terminus_intelligence FROM PUBLIC;

CREATE TABLE terminus_intelligence.accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 320),
  password_hash text NOT NULL CHECK (length(password_hash) BETWEEN 32 AND 1024),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE terminus_intelligence.owners (
  id uuid PRIMARY KEY,
  account_id uuid UNIQUE REFERENCES terminus_intelligence.accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  history boolean NOT NULL DEFAULT false,
  analytics boolean NOT NULL DEFAULT false,
  personalization boolean NOT NULL DEFAULT false,
  CHECK (NOT personalization OR history)
);
CREATE TABLE terminus_intelligence.sessions (
  id uuid PRIMARY KEY,
  credential_id text NOT NULL CHECK (length(credential_id) BETWEEN 1 AND 128),
  device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 256),
  owner_id uuid NOT NULL REFERENCES terminus_intelligence.owners(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  UNIQUE (credential_id, device_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE TABLE terminus_intelligence.command_events (
  owner_id uuid NOT NULL REFERENCES terminus_intelligence.owners(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  command text NOT NULL CHECK (octet_length(command) BETWEEN 1 AND 4096 AND command !~ '[[:cntrl:]]'),
  category text NOT NULL CHECK (length(category) BETWEEN 1 AND 64),
  purpose text NOT NULL CHECK (length(purpose) BETWEEN 1 AND 512),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (owner_id, event_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX ON terminus_intelligence.command_events(owner_id, created_at DESC);
CREATE INDEX ON terminus_intelligence.command_events(expires_at);
CREATE TABLE terminus_intelligence.analytics_events (
  owner_id uuid NOT NULL REFERENCES terminus_intelligence.owners(id) ON DELETE CASCADE,
  event_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('terminal.connected', 'terminal.disconnected', 'terminal.reconnecting', 'recommendation.impression', 'recommendation.click')),
  reference_id text CHECK (length(reference_id) <= 128),
  duration_ms bigint NOT NULL DEFAULT 0 CHECK (duration_ms BETWEEN 0 AND 45000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (owner_id, event_id),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '30 days')
);
CREATE INDEX ON terminus_intelligence.analytics_events(owner_id, created_at DESC);
CREATE INDEX ON terminus_intelligence.analytics_events(expires_at);

CREATE FUNCTION terminus_intelligence.require_consent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_TABLE_NAME = 'command_events' THEN
    SELECT history INTO allowed FROM terminus_intelligence.owners WHERE id = NEW.owner_id FOR SHARE;
  ELSE
    SELECT analytics INTO allowed FROM terminus_intelligence.owners WHERE id = NEW.owner_id FOR SHARE;
  END IF;
  IF NOT coalesce(allowed, false) THEN RAISE EXCEPTION 'consent required' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER command_consent BEFORE INSERT OR UPDATE ON terminus_intelligence.command_events
  FOR EACH ROW EXECUTE FUNCTION terminus_intelligence.require_consent();
CREATE TRIGGER analytics_consent BEFORE INSERT OR UPDATE ON terminus_intelligence.analytics_events
  FOR EACH ROW EXECUTE FUNCTION terminus_intelligence.require_consent();

CREATE TABLE terminus_intelligence.quota_months (
  owner_id uuid NOT NULL REFERENCES terminus_intelligence.owners(id),
  month date NOT NULL CHECK (extract(day FROM month) = 1),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
  reserved_tokens bigint NOT NULL DEFAULT 0 CHECK (reserved_tokens BETWEEN 0 AND 9007199254740991),
  token_limit bigint NOT NULL DEFAULT 100000 CHECK (token_limit BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (owner_id, month),
  CHECK (input_tokens + output_tokens + reserved_tokens <= token_limit)
);
CREATE TABLE terminus_intelligence.reservations (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  month date NOT NULL,
  max_tokens bigint NOT NULL CHECK (max_tokens BETWEEN 1 AND 9007199254740991),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'completed', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 seconds'),
  PRIMARY KEY (owner_id, request_id),
  UNIQUE (owner_id, request_id, month),
  FOREIGN KEY (owner_id, month) REFERENCES terminus_intelligence.quota_months(owner_id, month),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '10 minutes')
);
CREATE TABLE terminus_intelligence.token_ledger (
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  month date NOT NULL,
  input_tokens bigint NOT NULL CHECK (input_tokens BETWEEN 0 AND 9007199254740991),
  output_tokens bigint NOT NULL CHECK (output_tokens BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, request_id),
  FOREIGN KEY (owner_id, request_id, month) REFERENCES terminus_intelligence.reservations(owner_id, request_id, month),
  CHECK (input_tokens + output_tokens <= 9007199254740991)
);
-- Accounting identity is stable across history deletion, login and logout.
CREATE TABLE terminus_intelligence.quota_principals (
  credential_id text NOT NULL CHECK (length(credential_id) BETWEEN 1 AND 128),
  device_id text NOT NULL CHECK (length(device_id) BETWEEN 1 AND 256),
  owner_id uuid NOT NULL UNIQUE REFERENCES terminus_intelligence.owners(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (credential_id, device_id)
);
CREATE FUNCTION terminus_intelligence.immutable_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'token ledger is append only' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER immutable_ledger BEFORE UPDATE OR DELETE ON terminus_intelligence.token_ledger
  FOR EACH ROW EXECUTE FUNCTION terminus_intelligence.immutable_ledger();

CREATE FUNCTION terminus_intelligence.reserve_tokens(p_owner uuid, p_request uuid, p_month date, p_max bigint, p_expires timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, terminus_intelligence AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM terminus_intelligence.quota_principals WHERE owner_id = p_owner) THEN RETURN false; END IF;
  IF p_max IS NULL OR p_max < 1 OR p_max > 100000 OR p_month IS DISTINCT FROM date_trunc('month', now() AT TIME ZONE 'UTC')::date
    OR p_expires IS NULL OR p_expires <= now() OR p_expires > now() + interval '10 minutes' THEN RETURN false; END IF;
  INSERT INTO terminus_intelligence.quota_months(owner_id, month) VALUES (p_owner, p_month) ON CONFLICT DO NOTHING;
  PERFORM 1 FROM terminus_intelligence.quota_months WHERE owner_id = p_owner AND month = p_month FOR UPDATE;
  IF EXISTS (SELECT 1 FROM terminus_intelligence.reservations WHERE owner_id = p_owner AND request_id = p_request) THEN RETURN false; END IF;
  UPDATE terminus_intelligence.quota_months SET reserved_tokens = reserved_tokens + p_max
    WHERE owner_id = p_owner AND month = p_month AND input_tokens + output_tokens + reserved_tokens + p_max <= token_limit;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO terminus_intelligence.reservations(owner_id, request_id, month, max_tokens, expires_at)
    VALUES (p_owner, p_request, p_month, p_max, p_expires);
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_intelligence.finalize_tokens(p_owner uuid, p_request uuid, p_input bigint, p_output bigint, p_success boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, terminus_intelligence AS $$
DECLARE r terminus_intelligence.reservations%ROWTYPE;
BEGIN
  IF p_success IS NULL OR p_input IS NULL OR p_output IS NULL OR p_input < 0 OR p_output < 0
    OR p_input > 9007199254740991 OR p_output > 9007199254740991 THEN RETURN false; END IF;
  SELECT * INTO r FROM terminus_intelligence.reservations WHERE owner_id = p_owner AND request_id = p_request;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM terminus_intelligence.quota_months WHERE owner_id = p_owner AND month = r.month FOR UPDATE;
  SELECT * INTO r FROM terminus_intelligence.reservations WHERE owner_id = p_owner AND request_id = p_request FOR UPDATE;
  IF r.status <> 'reserved' OR (p_success AND p_input + p_output > r.max_tokens) THEN RETURN false; END IF;
  UPDATE terminus_intelligence.quota_months SET reserved_tokens = reserved_tokens - r.max_tokens,
    input_tokens = input_tokens + CASE WHEN p_success THEN p_input ELSE 0 END,
    output_tokens = output_tokens + CASE WHEN p_success THEN p_output ELSE 0 END
    WHERE owner_id = p_owner AND month = r.month;
  UPDATE terminus_intelligence.reservations SET status = CASE WHEN p_success THEN 'completed' ELSE 'failed' END
    WHERE owner_id = p_owner AND request_id = p_request;
  IF p_success THEN
    INSERT INTO terminus_intelligence.token_ledger(owner_id, request_id, month, input_tokens, output_tokens)
      VALUES (p_owner, p_request, r.month, p_input, p_output);
  END IF;
  RETURN true;
END;
$$;

CREATE INDEX ON terminus_intelligence.reservations(expires_at) WHERE status = 'reserved';
CREATE INDEX ON terminus_intelligence.sessions(expires_at);
CREATE INDEX ON terminus_intelligence.owners(last_seen_at) WHERE account_id IS NULL;

REVOKE ALL ON ALL TABLES IN SCHEMA terminus_intelligence FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA terminus_intelligence FROM PUBLIC;
COMMIT;
