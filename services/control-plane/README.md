# Terminus control-plane contract 0.1

This directory defines the S04-001 contract for a future, metadata-only control
plane. It is not a deployed service and contains no HTTP handler or terminal
transport. The personal Vercel Hobby prototype does not call this contract.

## Boundaries

- The browser-to-Windows-agent terminal stream remains direct and private.
- This service may issue a signed, short-lived authorization lease. It never
  receives terminal input, output, clipboard data, shell environment, or a
  terminal encryption key.
- Human tenant roles and product/staff entitlements are independent grants.
  In particular, an `owner` still needs the `terminal_access` entitlement and
  available quota before a lease can be issued.
- Subscription records are passive provider-synchronization metadata. Public
  checkout, paid onboarding, advertisements, and plan activation are gated off
  until commercial hosting and product decisions are approved.
- There is no super-administrator terminal grant, universal decryption key, or
  silent tenant impersonation path.
- Authorization receives fully resolved tenant-scoped UUIDs. Lease policy binds
  the client-requested pairing ID to the resolved pairing row, host, device key,
  membership, and entitlement; a missing identity fails closed.
- Final-owner preservation is a database invariant. Role mutations atomically
  update a tenant-owned owner counter, so stale caller counts and concurrent
  revocations cannot remove the final active owner role.

## Contract artifacts

- `contracts/domain-model.json` defines entities, authorization invariants,
  retention, and the minimized data map.
- `contracts/openapi.json` defines the proposed metadata API surface and uniform
  rejection behavior. It deliberately has no server URL.
- `contracts/lease-claims.schema.json` defines a signed lease payload with a
  maximum five-minute lifetime and a single tenant/member/host audience.
- `src/authorization.mjs` is an executable reference policy, not a network
  handler. API and abuse tests exercise it before any handler is added. Its
  `evaluatedAtEpochSeconds` input represents a trusted server clock and is not
  part of the client request contract. Its `requestedPairingId` is the parsed
  request value; `target.pairingId` is the exact tenant-scoped row resolved from
  that value.
- `../../infrastructure/database/migrations/0001_control_plane.sql` is the sole
  migration history for this task. Tenant-owned foreign keys include
  `tenant_id`, and row-level policies fail closed without transaction-local
  tenant context.

## Checks

From this directory:

```powershell
npm run format:check
npm run lint
npm run typecheck
npm test
```

The isolated PostgreSQL check is documented in
`../../infrastructure/database/README.md`.

PostgreSQL composite foreign keys and row-security behavior were designed
against the PostgreSQL 18 documentation (the migration uses features available
in PostgreSQL 17):

- https://www.postgresql.org/docs/current/ddl-constraints.html
- https://www.postgresql.org/docs/current/ddl-rowsecurity.html

The isolated harness image tag was checked against the Docker Official Images
source-of-truth entry for PostgreSQL:

- https://github.com/docker-library/official-images/blob/master/library/postgres
