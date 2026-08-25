# Control-plane database contract

`migrations/0001_control_plane.sql` is the single S04-001 migration history.
It targets PostgreSQL 17 or newer and creates metadata-only tables under the
`terminus_cp` schema.

Tenant isolation has two layers:

1. Every tenant-owned primary key and foreign key carries `tenant_id`, so an
   object from one tenant cannot satisfy another tenant's reference.
2. Every tenant table has forced row-level security. The application must set
   `terminus.tenant_id` locally inside each transaction. Missing context sees no
   tenant rows; a cross-tenant write is rejected.

The migration deliberately does not create a login role, database, network
listener, extension, billing product, or deployment. Production role grants and
atomic lease issuance procedures belong to a later implementation task.

## Isolated validation

The harness creates a uniquely named disposable PostgreSQL container, copies
only the migration and invariant test into it, runs both with `ON_ERROR_STOP`,
and removes that exact container in `finally`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\run-isolated-tests.ps1
```

It uses `postgres:17.11-alpine3.24` pinned to manifest digest
`sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73`.
The tag was listed by the Docker Official Images PostgreSQL source-of-truth and
the digest was resolved by Docker on 2026-08-26. Docker must already be installed
and running. The harness does not deploy or retain a database.

## Application transaction rule

An eventual API implementation must use a non-owner, non-`BYPASSRLS` database
role and wrap every tenant operation as follows:

```sql
BEGIN;
SELECT set_config('terminus.tenant_id', $1, true);
-- parameterized metadata queries only
COMMIT;
```

Connection-pool return with an open transaction is forbidden. `SET` without
transaction-local scope is forbidden because it can leak tenant context to the
next borrower.
