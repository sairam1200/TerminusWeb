\set ON_ERROR_STOP on

CREATE SCHEMA terminus_test;

CREATE FUNCTION terminus_test.assert_equal(actual bigint, expected bigint, message text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'assertion failed: % (actual %, expected %)', message, actual, expected;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'terminus_cp_test_app') THEN
    CREATE ROLE terminus_cp_test_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END;
$$;

GRANT USAGE ON SCHEMA terminus_cp, terminus_test TO terminus_cp_test_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA terminus_test TO terminus_cp_test_app;
GRANT SELECT ON ALL TABLES IN SCHEMA terminus_cp TO terminus_cp_test_app;
GRANT INSERT ON terminus_cp.hosts TO terminus_cp_test_app;

INSERT INTO terminus_cp.accounts (id, identity_provider, provider_subject, email_normalized) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'test', 'subject-a', 'a@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'test', 'subject-b', 'b@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'test', 'subject-c1', 'c1@example.invalid'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'test', 'subject-c2', 'c2@example.invalid');

INSERT INTO terminus_cp.tenants (id, display_name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Tenant A'),
  ('22222222-2222-4222-8222-222222222222', 'Tenant B'),
  ('33333333-3333-4333-8333-333333333333', 'Tenant C');

INSERT INTO terminus_cp.memberships (tenant_id, id, account_id, state) VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-aaaa-4aaa-8aaa-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'active'),
  ('22222222-2222-4222-8222-222222222222', '22222222-bbbb-4bbb-8bbb-222222222222', 'aaaaaaaa-0000-4000-8000-000000000002', 'active'),
  ('33333333-3333-4333-8333-333333333333', '33333333-aaaa-4aaa-8aaa-333333333331', 'aaaaaaaa-0000-4000-8000-000000000003', 'active'),
  ('33333333-3333-4333-8333-333333333333', '33333333-bbbb-4bbb-8bbb-333333333332', 'aaaaaaaa-0000-4000-8000-000000000004', 'active');

INSERT INTO terminus_cp.role_assignments (
  tenant_id,
  id,
  membership_id,
  role,
  assignment_source
) VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-0001-4000-8000-111111111111', '11111111-aaaa-4aaa-8aaa-111111111111', 'owner', 'tenant_bootstrap'),
  ('22222222-2222-4222-8222-222222222222', '22222222-0001-4000-8000-222222222222', '22222222-bbbb-4bbb-8bbb-222222222222', 'owner', 'tenant_bootstrap'),
  ('33333333-3333-4333-8333-333333333333', '33333333-0001-4000-8000-333333333331', '33333333-aaaa-4aaa-8aaa-333333333331', 'owner', 'tenant_bootstrap'),
  ('33333333-3333-4333-8333-333333333333', '33333333-0002-4000-8000-333333333332', '33333333-bbbb-4bbb-8bbb-333333333332', 'owner', 'tenant_bootstrap');

INSERT INTO terminus_cp.hosts (tenant_id, id, label, tailnet_dns_name) VALUES
  ('11111111-1111-4111-8111-111111111111', '11111111-1000-4000-8000-111111111111', 'Host A', 'host-a.example.ts.net'),
  ('22222222-2222-4222-8222-222222222222', '22222222-2000-4000-8000-222222222222', 'Host B', 'host-b.example.ts.net');

INSERT INTO terminus_cp.device_keys (
  tenant_id,
  id,
  host_id,
  algorithm,
  public_key_spki,
  fingerprint_sha256,
  valid_after,
  expires_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1001-4000-8000-111111111111',
  '11111111-1000-4000-8000-111111111111',
  'Ed25519',
  repeat('A', 64),
  decode(repeat('11', 32), 'hex'),
  transaction_timestamp(),
  transaction_timestamp() + interval '1 day'
);

INSERT INTO terminus_cp.pairings (
  tenant_id,
  id,
  membership_id,
  host_id,
  browser_key_thumbprint,
  state,
  expires_at,
  confirmed_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1002-4000-8000-111111111111',
  '11111111-aaaa-4aaa-8aaa-111111111111',
  '11111111-1000-4000-8000-111111111111',
  decode(repeat('22', 32), 'hex'),
  'confirmed',
  transaction_timestamp() + interval '10 minutes',
  transaction_timestamp()
);

INSERT INTO terminus_cp.entitlement_grants (
  tenant_id,
  id,
  entitlement_key,
  subject_membership_id,
  source,
  starts_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1003-4000-8000-111111111111',
  'terminal_access',
  '11111111-aaaa-4aaa-8aaa-111111111111',
  'free',
  transaction_timestamp()
);

INSERT INTO terminus_cp.leases (
  tenant_id,
  id,
  membership_id,
  host_id,
  pairing_id,
  entitlement_key,
  quota_units,
  signing_key_id,
  nonce_hash,
  token_hash,
  not_before,
  expires_at
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1004-4000-8000-111111111111',
  '11111111-aaaa-4aaa-8aaa-111111111111',
  '11111111-1000-4000-8000-111111111111',
  '11111111-1002-4000-8000-111111111111',
  'terminal_access',
  1,
  'test-key-1',
  decode(repeat('33', 32), 'hex'),
  decode(repeat('44', 32), 'hex'),
  transaction_timestamp(),
  transaction_timestamp() + interval '5 minutes'
);

INSERT INTO terminus_cp.quota_ledger (
  tenant_id,
  id,
  membership_id,
  lease_id,
  entitlement_key,
  entry_kind,
  units_delta,
  idempotency_key,
  retain_until
) VALUES (
  '11111111-1111-4111-8111-111111111111',
  '11111111-1005-4000-8000-111111111111',
  '11111111-aaaa-4aaa-8aaa-111111111111',
  '11111111-1004-4000-8000-111111111111',
  'terminal_access',
  'reserve',
  -1,
  '11111111-1006-4000-8000-111111111111',
  transaction_timestamp() + interval '365 days'
);

CREATE FUNCTION terminus_test.cross_tenant_foreign_key_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO terminus_cp.device_keys (
    tenant_id,
    id,
    host_id,
    algorithm,
    public_key_spki,
    fingerprint_sha256,
    valid_after,
    expires_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    '11111111-9001-4000-8000-111111111111',
    '22222222-2000-4000-8000-222222222222',
    'Ed25519',
    repeat('B', 64),
    decode(repeat('55', 32), 'hex'),
    transaction_timestamp(),
    transaction_timestamp() + interval '1 day'
  );
  RETURN false;
EXCEPTION WHEN foreign_key_violation THEN
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_test.overlong_lease_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO terminus_cp.leases (
    tenant_id,
    id,
    membership_id,
    host_id,
    pairing_id,
    entitlement_key,
    quota_units,
    signing_key_id,
    nonce_hash,
    token_hash,
    not_before,
    expires_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    '11111111-9002-4000-8000-111111111111',
    '11111111-aaaa-4aaa-8aaa-111111111111',
    '11111111-1000-4000-8000-111111111111',
    '11111111-1002-4000-8000-111111111111',
    'terminal_access',
    1,
    'test-key-1',
    decode(repeat('66', 32), 'hex'),
    decode(repeat('77', 32), 'hex'),
    transaction_timestamp(),
    transaction_timestamp() + interval '301 seconds'
  );
  RETURN false;
EXCEPTION WHEN check_violation THEN
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_test.quota_mutation_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE terminus_cp.quota_ledger
    SET units_delta = -2
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-1005-4000-8000-111111111111';
  RETURN false;
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_test.final_owner_revocation_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE terminus_cp.role_assignments
    SET revoked_at = transaction_timestamp()
    WHERE tenant_id = '22222222-2222-4222-8222-222222222222'
      AND id = '22222222-0001-4000-8000-222222222222';
  RETURN false;
EXCEPTION WHEN check_violation THEN
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_test.lease_offset_accepted(offset_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  candidate_id uuid := format(
    '11111111-7000-4000-8000-%s',
    lpad((offset_seconds + 1000)::text, 12, '0')
  )::uuid;
BEGIN
  INSERT INTO terminus_cp.leases (
    tenant_id,
    id,
    membership_id,
    host_id,
    pairing_id,
    entitlement_key,
    quota_units,
    signing_key_id,
    nonce_hash,
    token_hash,
    not_before,
    expires_at
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    candidate_id,
    '11111111-aaaa-4aaa-8aaa-111111111111',
    '11111111-1000-4000-8000-111111111111',
    '11111111-1002-4000-8000-111111111111',
    'terminal_access',
    1,
    'test-key-1',
    decode(lpad(to_hex(offset_seconds + 1000), 64, '0'), 'hex'),
    decode(lpad(to_hex(offset_seconds + 2000), 64, '0'), 'hex'),
    transaction_timestamp() + make_interval(secs => offset_seconds),
    transaction_timestamp() + make_interval(secs => offset_seconds + 300)
  );
  RETURN true;
EXCEPTION WHEN check_violation THEN
  RETURN false;
END;
$$;

CREATE FUNCTION terminus_test.premature_quota_purge_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM terminus_cp.quota_ledger
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-1005-4000-8000-111111111111';
  RETURN false;
EXCEPTION WHEN object_not_in_prerequisite_state THEN
  RETURN true;
END;
$$;

CREATE FUNCTION terminus_test.lease_purge_detaches_quota_reference()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM terminus_cp.leases
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-1004-4000-8000-111111111111';
  RETURN EXISTS (
    SELECT 1 FROM terminus_cp.quota_ledger
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = '11111111-1005-4000-8000-111111111111'
      AND lease_id IS NULL
  );
END;
$$;

CREATE FUNCTION terminus_test.expired_quota_purge_allowed()
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  expired_entry_id constant uuid := '11111111-9005-4000-8000-111111111111';
BEGIN
  INSERT INTO terminus_cp.quota_ledger (
    tenant_id,
    id,
    entitlement_key,
    entry_kind,
    units_delta,
    idempotency_key,
    occurred_at,
    retain_until
  ) VALUES (
    '11111111-1111-4111-8111-111111111111',
    expired_entry_id,
    'terminal_access',
    'grant',
    1,
    '11111111-9006-4000-8000-111111111111',
    transaction_timestamp() - interval '2 days',
    transaction_timestamp() - interval '1 day'
  );
  DELETE FROM terminus_cp.quota_ledger
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = expired_entry_id;
  RETURN NOT EXISTS (
    SELECT 1 FROM terminus_cp.quota_ledger
    WHERE tenant_id = '11111111-1111-4111-8111-111111111111'
      AND id = expired_entry_id
  );
END;
$$;

CREATE FUNCTION terminus_test.cross_tenant_rls_write_rejected()
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO terminus_cp.hosts (tenant_id, id, label, tailnet_dns_name) VALUES (
    '22222222-2222-4222-8222-222222222222',
    '22222222-9003-4000-8000-222222222222',
    'Blocked Host',
    'blocked.example.ts.net'
  );
  RETURN false;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN true;
END;
$$;

SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM terminus_cp.schema_migrations WHERE version = '0001_control_plane'),
  1,
  'migration version is recorded exactly once'
);

SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'terminus_cp' AND c.relrowsecurity AND c.relforcerowsecurity),
  11,
  'all tenant tables force row-level security'
);

SELECT terminus_test.assert_equal(
  has_table_privilege('terminus_cp_test_app', 'terminus_cp.quota_ledger', 'UPDATE, DELETE')::integer,
  0,
  'application role has no quota update or delete privilege'
);

SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM pg_trigger
   WHERE tgrelid = 'terminus_cp.role_assignments'::regclass
     AND tgname = 'preserve_final_owner'
     AND NOT tgisinternal),
  1,
  'role assignments have one database final-owner trigger'
);

SELECT terminus_test.assert_equal(
  (SELECT active_owner_count FROM terminus_cp.tenants
   WHERE id = '11111111-1111-4111-8111-111111111111'),
  1,
  'tenant A owner count is derived from role assignments'
);

SELECT terminus_test.assert_equal(
  (SELECT active_owner_count FROM terminus_cp.tenants
   WHERE id = '33333333-3333-4333-8333-333333333333'),
  2,
  'tenant C has two owners for the concurrent revocation test'
);

SELECT terminus_test.assert_equal(
  terminus_test.final_owner_revocation_rejected()::integer,
  1,
  'database rejects direct revocation of the final owner'
);

SELECT terminus_test.assert_equal(
  (SELECT terminus_test.cross_tenant_foreign_key_rejected()::integer),
  1,
  'composite foreign key rejects cross-tenant host reference'
);

SELECT terminus_test.assert_equal(
  (SELECT terminus_test.overlong_lease_rejected()::integer),
  1,
  'lease lifetime above five minutes is rejected'
);

SELECT terminus_test.assert_equal(
  (SELECT terminus_test.quota_mutation_rejected()::integer),
  1,
  'quota ledger is append-only'
);

SELECT terminus_test.assert_equal(terminus_test.lease_offset_accepted(-31)::integer, 0, 'lease at -31 seconds is rejected');
SELECT terminus_test.assert_equal(terminus_test.lease_offset_accepted(-30)::integer, 1, 'lease at -30 seconds is accepted');
SELECT terminus_test.assert_equal(terminus_test.lease_offset_accepted(30)::integer, 1, 'lease at +30 seconds is accepted');
SELECT terminus_test.assert_equal(terminus_test.lease_offset_accepted(31)::integer, 0, 'lease at +31 seconds is rejected');

SELECT terminus_test.assert_equal(
  terminus_test.premature_quota_purge_rejected()::integer,
  1,
  'quota entry cannot be purged before retain_until'
);

SELECT terminus_test.assert_equal(
  (SELECT terminus_test.lease_purge_detaches_quota_reference()::integer),
  1,
  'lease purge detaches its retained quota reference'
);

SELECT terminus_test.assert_equal(
  (SELECT terminus_test.expired_quota_purge_allowed()::integer),
  1,
  'quota entry can be purged only after retain_until'
);

BEGIN;
SET LOCAL ROLE terminus_cp_test_app;
SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM terminus_cp.hosts),
  0,
  'missing tenant context sees no host rows'
);
COMMIT;

BEGIN;
SET LOCAL ROLE terminus_cp_test_app;
SELECT set_config('terminus.tenant_id', '11111111-1111-4111-8111-111111111111', true);
SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM terminus_cp.hosts),
  1,
  'tenant A sees only its host'
);
SELECT terminus_test.assert_equal(
  (SELECT terminus_test.cross_tenant_rls_write_rejected()::integer),
  1,
  'tenant A cannot insert a tenant B host'
);
COMMIT;

SELECT terminus_test.assert_equal(
  (SELECT count(*) FROM terminus_cp.hosts),
  2,
  'failed cross-tenant write left fixtures unchanged'
);

\echo 'S04-001 isolated PostgreSQL invariants: PASS'
