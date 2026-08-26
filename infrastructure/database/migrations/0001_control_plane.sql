BEGIN;

CREATE SCHEMA terminus_cp;

CREATE TYPE terminus_cp.tenant_state AS ENUM ('active', 'suspended', 'closed');
CREATE TYPE terminus_cp.membership_state AS ENUM ('invited', 'active', 'suspended', 'closed');
CREATE TYPE terminus_cp.role_name AS ENUM ('owner', 'admin', 'operator', 'auditor');
CREATE TYPE terminus_cp.role_assignment_source AS ENUM ('tenant_bootstrap', 'human');
CREATE TYPE terminus_cp.host_state AS ENUM ('active', 'disabled', 'deleted');
CREATE TYPE terminus_cp.key_state AS ENUM ('active', 'revoked', 'expired');
CREATE TYPE terminus_cp.pairing_state AS ENUM ('pending', 'confirmed', 'consumed', 'revoked', 'expired');
CREATE TYPE terminus_cp.entitlement_state AS ENUM ('active', 'suspended', 'expired', 'revoked');
CREATE TYPE terminus_cp.entitlement_source AS ENUM ('free', 'premium', 'staff', 'manual', 'subscription');
CREATE TYPE terminus_cp.lease_state AS ENUM ('issued', 'consumed', 'expired', 'released', 'revoked');
CREATE TYPE terminus_cp.quota_entry_kind AS ENUM ('grant', 'reserve', 'release', 'expire', 'adjustment');
CREATE TYPE terminus_cp.subscription_state AS ENUM ('inactive', 'trialing', 'active', 'past_due', 'canceled');
CREATE TYPE terminus_cp.audit_action AS ENUM (
  'membership.changed',
  'role.changed',
  'host.changed',
  'device_key.changed',
  'pairing.changed',
  'entitlement.changed',
  'lease.changed',
  'subscription.changed'
);
CREATE TYPE terminus_cp.audit_outcome AS ENUM ('allowed', 'denied');
CREATE TYPE terminus_cp.audit_resource_kind AS ENUM (
  'membership',
  'role_assignment',
  'host',
  'device_key',
  'pairing',
  'entitlement',
  'lease',
  'subscription'
);

CREATE TABLE terminus_cp.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CHECK (version ~ '^[0-9]{4}_[a-z0-9_]+$')
);

CREATE TABLE terminus_cp.accounts (
  id uuid PRIMARY KEY,
  identity_provider text NOT NULL CHECK (length(identity_provider) BETWEEN 1 AND 64),
  provider_subject text NOT NULL CHECK (length(provider_subject) BETWEEN 1 AND 255),
  email_normalized text CHECK (email_normalized = lower(email_normalized) AND length(email_normalized) <= 320),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  deleted_at timestamptz,
  UNIQUE (identity_provider, provider_subject),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);

CREATE TABLE terminus_cp.tenants (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 120),
  state terminus_cp.tenant_state NOT NULL DEFAULT 'active',
  retention_days integer NOT NULL DEFAULT 365 CHECK (retention_days BETWEEN 30 AND 3650),
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  closed_at timestamptz,
  CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);

CREATE TABLE terminus_cp.memberships (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  state terminus_cp.membership_state NOT NULL DEFAULT 'invited',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  ended_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, account_id),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT,
  FOREIGN KEY (account_id) REFERENCES terminus_cp.accounts (id) ON DELETE RESTRICT,
  CHECK ((state = 'closed') = (ended_at IS NOT NULL))
);

CREATE TABLE terminus_cp.role_assignments (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role terminus_cp.role_name NOT NULL,
  assignment_source terminus_cp.role_assignment_source NOT NULL,
  assigned_by_membership_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE NULLS NOT DISTINCT (tenant_id, membership_id, role, revoked_at),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, assigned_by_membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  CHECK (
    (assignment_source = 'tenant_bootstrap' AND assigned_by_membership_id IS NULL AND role = 'owner')
    OR (assignment_source = 'human' AND assigned_by_membership_id IS NOT NULL)
  ),
  CHECK (revoked_at IS NULL OR revoked_at >= assigned_at)
);

CREATE TABLE terminus_cp.hosts (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  tailnet_dns_name text NOT NULL CHECK (length(tailnet_dns_name) BETWEEN 1 AND 253),
  state terminus_cp.host_state NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  deleted_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, tailnet_dns_name),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT,
  CHECK ((state = 'deleted') = (deleted_at IS NOT NULL))
);

CREATE TABLE terminus_cp.device_keys (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  host_id uuid NOT NULL,
  algorithm text NOT NULL CHECK (algorithm IN ('Ed25519', 'ES256')),
  public_key_spki text NOT NULL CHECK (length(public_key_spki) BETWEEN 32 AND 2048),
  fingerprint_sha256 bytea NOT NULL CHECK (octet_length(fingerprint_sha256) = 32),
  state terminus_cp.key_state NOT NULL DEFAULT 'active',
  valid_after timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, fingerprint_sha256),
  FOREIGN KEY (tenant_id, host_id)
    REFERENCES terminus_cp.hosts (tenant_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > valid_after),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE terminus_cp.pairings (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  host_id uuid NOT NULL,
  browser_key_thumbprint bytea NOT NULL CHECK (octet_length(browser_key_thumbprint) = 32),
  state terminus_cp.pairing_state NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, id, membership_id, host_id),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, host_id)
    REFERENCES terminus_cp.hosts (tenant_id, id) ON DELETE RESTRICT,
  CHECK (expires_at > created_at),
  CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL)),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
);

CREATE TABLE terminus_cp.entitlement_catalog (
  entitlement_key text PRIMARY KEY,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 255),
  grants_terminal_access boolean NOT NULL DEFAULT false
);

CREATE TABLE terminus_cp.entitlement_grants (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  entitlement_key text NOT NULL,
  subject_membership_id uuid,
  source terminus_cp.entitlement_source NOT NULL,
  state terminus_cp.entitlement_state NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, subject_membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (entitlement_key)
    REFERENCES terminus_cp.entitlement_catalog (entitlement_key) ON DELETE RESTRICT,
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE terminus_cp.subscriptions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 32),
  provider_customer_ref_hash bytea NOT NULL CHECK (octet_length(provider_customer_ref_hash) = 32),
  provider_subscription_ref_hash bytea NOT NULL CHECK (octet_length(provider_subscription_ref_hash) = 32),
  state terminus_cp.subscription_state NOT NULL DEFAULT 'inactive',
  plan_code text NOT NULL CHECK (length(plan_code) BETWEEN 1 AND 64),
  current_period_ends_at timestamptz,
  provider_updated_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, provider, provider_subscription_ref_hash),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT
);

CREATE TABLE terminus_cp.leases (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid NOT NULL,
  host_id uuid NOT NULL,
  pairing_id uuid NOT NULL,
  entitlement_key text NOT NULL,
  quota_units integer NOT NULL CHECK (quota_units BETWEEN 1 AND 1000000),
  state terminus_cp.lease_state NOT NULL DEFAULT 'issued',
  signing_key_id text NOT NULL CHECK (length(signing_key_id) BETWEEN 1 AND 128),
  nonce_hash bytea NOT NULL CHECK (octet_length(nonce_hash) = 32),
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  issued_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  not_before timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  released_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, nonce_hash),
  UNIQUE (tenant_id, token_hash),
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, host_id)
    REFERENCES terminus_cp.hosts (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, pairing_id, membership_id, host_id)
    REFERENCES terminus_cp.pairings (tenant_id, id, membership_id, host_id) ON DELETE RESTRICT,
  FOREIGN KEY (entitlement_key)
    REFERENCES terminus_cp.entitlement_catalog (entitlement_key) ON DELETE RESTRICT,
  CHECK (not_before BETWEEN issued_at - interval '30 seconds' AND issued_at + interval '30 seconds'),
  CHECK (expires_at > not_before AND expires_at <= not_before + interval '5 minutes'),
  CHECK ((state = 'consumed') = (consumed_at IS NOT NULL)),
  CHECK ((state = 'released') = (released_at IS NOT NULL))
);

CREATE TABLE terminus_cp.quota_ledger (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  membership_id uuid,
  lease_id uuid,
  entitlement_key text NOT NULL,
  entry_kind terminus_cp.quota_entry_kind NOT NULL,
  units_delta bigint NOT NULL CHECK (units_delta <> 0),
  idempotency_key uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, membership_id)
    REFERENCES terminus_cp.memberships (tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, lease_id)
    REFERENCES terminus_cp.leases (tenant_id, id) ON DELETE SET NULL (lease_id),
  FOREIGN KEY (entitlement_key)
    REFERENCES terminus_cp.entitlement_catalog (entitlement_key) ON DELETE RESTRICT,
  CHECK (entry_kind IN ('reserve', 'release', 'expire') OR lease_id IS NULL),
  CHECK ((entry_kind = 'reserve' AND units_delta < 0) OR (entry_kind <> 'reserve' AND units_delta > 0)),
  CHECK (retain_until > occurred_at)
);

CREATE FUNCTION terminus_cp.reject_quota_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.entry_kind IN ('reserve', 'release', 'expire') AND NEW.lease_id IS NULL THEN
      RAISE EXCEPTION 'lease quota entries require a live lease reference at insertion' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
    AND OLD.lease_id IS NOT NULL
    AND NEW.lease_id IS NULL
    AND (to_jsonb(NEW) - 'lease_id') = (to_jsonb(OLD) - 'lease_id') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND OLD.retain_until <= transaction_timestamp() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'quota ledger is append-only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER quota_ledger_append_only
BEFORE INSERT OR UPDATE OR DELETE ON terminus_cp.quota_ledger
FOR EACH ROW EXECUTE FUNCTION terminus_cp.reject_quota_ledger_mutation();

CREATE TABLE terminus_cp.audit_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  actor_account_id uuid,
  action terminus_cp.audit_action NOT NULL,
  outcome terminus_cp.audit_outcome NOT NULL,
  resource_kind terminus_cp.audit_resource_kind NOT NULL,
  resource_id uuid,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES terminus_cp.tenants (id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_account_id) REFERENCES terminus_cp.accounts (id) ON DELETE SET NULL,
  CHECK (retain_until > occurred_at)
);

CREATE INDEX memberships_account_idx ON terminus_cp.memberships (account_id, tenant_id);
CREATE INDEX active_roles_idx ON terminus_cp.role_assignments (tenant_id, membership_id, role) WHERE revoked_at IS NULL;
CREATE INDEX active_device_keys_idx ON terminus_cp.device_keys (tenant_id, host_id) WHERE state = 'active';
CREATE INDEX pairings_expiry_idx ON terminus_cp.pairings (tenant_id, expires_at);
CREATE INDEX entitlement_lookup_idx ON terminus_cp.entitlement_grants (tenant_id, subject_membership_id, entitlement_key, state);
CREATE INDEX active_leases_idx ON terminus_cp.leases (tenant_id, membership_id, expires_at) WHERE state = 'issued';
CREATE INDEX quota_balance_idx ON terminus_cp.quota_ledger (tenant_id, membership_id, entitlement_key, occurred_at);
CREATE INDEX audit_retention_idx ON terminus_cp.audit_events (tenant_id, retain_until);

INSERT INTO terminus_cp.entitlement_catalog (entitlement_key, description, grants_terminal_access) VALUES
  ('terminal_access', 'May request a short-lived direct-to-host authorization lease', true),
  ('premium', 'Premium product tier marker; grants no role or terminal access by itself', false),
  ('staff', 'Staff product marker; grants no tenant role or terminal access by itself', false);

ALTER TABLE terminus_cp.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.tenants
  USING (id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.memberships
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.role_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.role_assignments
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.hosts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.hosts
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.device_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.device_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.device_keys
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.pairings
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.entitlement_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.entitlement_grants
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.subscriptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.subscriptions
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.leases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.leases
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.quota_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.quota_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.quota_ledger
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

ALTER TABLE terminus_cp.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminus_cp.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminus_cp.audit_events
  USING (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('terminus.tenant_id', true), '')::uuid);

INSERT INTO terminus_cp.schema_migrations (version) VALUES ('0001_control_plane');

COMMIT;
