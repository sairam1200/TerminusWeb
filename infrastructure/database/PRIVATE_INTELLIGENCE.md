# Private intelligence database

S04-003 implements the private schema agreed with the Session 03 Go owner under
`packages/protocol/INTELLIGENCE-1.0.md` (contract input `79cc961`). The existing
metadata-only `terminus_cp` migration and commercial activation state are unchanged.
This schema is used only by the private Windows agent. Neither Vercel nor the
control-plane service receives commands, passwords, history, or model context.

## Explicit setup

Use PostgreSQL 17 or newer on the private host. Preserve loopback/private network
access and authenticate the application with an administrator-provisioned login.
Read the connection string from `TERMINUS_INTELLIGENCE_DATABASE_URL` on the agent;
never print it or put it in a browser variable. Do not run migrations at startup.

1. Back up the intended private database and verify its identity without displaying
   connection credentials. Use an administrative connection separate from the app.
2. Apply `migrations/0002_private_intelligence.sql` exactly once with `psql` and
   `ON_ERROR_STOP=1`. It is one transaction; a failure leaves no partial schema.
   `0001_control_plane.sql` remains the earlier independent metadata migration.
3. Apply `intelligence-role.sql` exactly once. It creates a NOLOGIN capability role.
   Provision a private login through the existing protected secret mechanism and
   grant it membership in `terminus_intelligence_app`. The application login must
   inherit that membership (or explicitly SET ROLE). Never use the schema owner,
   a superuser, CREATEROLE, or BYPASSRLS account as the application login.
4. Verify application-role access and absence of `terminus_cp` grants. The capability
   role can mutate identity/consent/events but can only read quota and token tables.
   Quota mutations are restricted to the two checked SECURITY DEFINER functions,
   whose search path is fixed and whose PUBLIC execution rights are revoked.
5. Start the agent with its protected database configuration. Missing or failed
   database configuration leaves intelligence unavailable while terminal transport
   continues to operate. No billing operation is activated by this migration.

## Consumer agreement

SQL uses schema-qualified names and parameterized values. Sessions bind one active
application session to the authenticated `credential_id` and `device_id` pair.
`owner_id` is separate from application session ID; an account has one owner, while
a new guest has a new owner. Login/logout atomically rotate session ID and owner
association under a lock. History linking must select only the caller's old guest
owner and respect destination consent. The database trigger rejects command/event
writes when the corresponding owner consent is off. It cannot determine whether
text is a reviewed command template; the Go sanitizer is a mandatory boundary.

There is no claim of per-user database RLS: the trusted Go server resolves owner
from the credential/device and applies owner predicates on every read and write.
End users never receive database access. Cross-owner API authorization must be
tested by the Go consumer; SQL tests exercise composite keys, foreign keys, consent
on owner changes, scoped queries, and cross-owner reservation finalization.

Quota calls are:

```sql
SELECT terminus_intelligence.reserve_tokens(
  $1::uuid, $2::uuid, $3::date, $4::bigint, $5::timestamptz);
SELECT terminus_intelligence.finalize_tokens(
  $1::uuid, $2::uuid, $3::bigint, $4::bigint, $5::boolean);
```

Both return boolean. Reserve takes owner, provider-request UUID, current UTC month
start, maximum tokens, and expiry (at most ten minutes). False means refused;
never call a model without a successful reservation. Finalize takes owner, request,
actual input/output counts, and success. Success inserts exactly one immutable
ledger record; failure releases reserved capacity with no invented usage. Duplicate
finalization returns false. Actual counts exceeding the reservation are rejected;
the consumer must cap model context/output before reservation. All bucket mutation
serializes on the owner/month row. App grants prohibit direct ledger/counter edits.

The quota owner is resolved from `quota_principals` using the protected credential
and device pair, independently from the current history/account owner. This mapping
is created once under the credential/device transaction lock; the app has SELECT
and INSERT only, with no UPDATE or DELETE. It references an opaque owner with no
account or consented data. Reservations reject history owners without this binding.
The monthly 100000-token limit is therefore per paired credential/device. Login,
logout, session expiry and guest deletion cannot reset it. Usage and billing must
label this as paired-device AI quota, while commands/history remain scoped to the
current history owner. A new pairing is a new quota principal; revocation does not
rewrite existing measured accounting. The future control-plane entitlement ledger
is unaffected.

## Retention and deletion

The Go consumer must exclude expired records immediately and run bounded maintenance:
delete expired commands/events/sessions in batches, expire seven-day inactive guest
identity associations, and finalize abandoned reserved requests with zero counts and
success=false. Commands/events cannot be retained beyond 30 days by their expires_at
constraints. Guest deletion removes identifying session rows and optional data.
An owner referenced by append-only usage remains an opaque accounting tombstone;
do not invent deletion of immutable ledger records or discard quota to allow resets.
Consent should be disabled on tombstones. The consumer must not return another
owner's usage or expired history, even before physical purge runs.

No unstructured JSON event payloads, terminal output, raw addresses, MAC data,
credential secrets, original arbitrary command arguments, or model queries belong
in this schema. Passwords are stored only as validated password-hash encodings.
`duration_ms` is a client-observed connection interval bounded to 45000 ms, never a
shell command duration. Aggregate results must remain JavaScript-safe integers.

## Verification and rollback

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File infrastructure/database/run-isolated-tests.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File infrastructure/database/run-intelligence-tests.ps1
```

Both run actual pinned PostgreSQL 17 Docker containers and remove their unique
containers in `finally`. No host ports are published. Synthetic fixtures contain
only redacted placeholder text. The new harness exercises migration, private-role
grants, consent, owner association, retention, ledger immutability, measured usage,
two-connection quota competition, and rollback isolation. The original control-plane
invariant and two-connection final-owner test remain unchanged.

To disable safely, stop intelligence consumers and remove their database capability
grant/configuration; terminal connectivity is independent. Destructive rollback is
an explicit administrator action after backup: drop only `terminus_intelligence`
with CASCADE, then remove the unused capability role. This permanently removes
private intelligence data, so it is not an automatic deployment rollback. The
disposable harness verifies that dropping this schema preserves `terminus_cp`.

Dependency evidence: PostgreSQL 17 runtime and SQL functions/constraints were tested
against the existing pinned Official PostgreSQL image named in the harness. No
new extension, SQL driver, dependency, payment provider, or hosted model was added.
