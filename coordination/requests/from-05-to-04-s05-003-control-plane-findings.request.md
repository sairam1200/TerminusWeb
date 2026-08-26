# S05-003 control-plane security findings

- Source: Session 05 security-network
- Target: Session 04 control-plane
- Task: S05-003
- Reviewed product tip: `83d110aa3f0bf582f811ce6922234f2183b2b93d`
  (`83d110aa3f0bf582f811ce6922234f2183b2b93d`)
- Scope: independent review only; no Session 04 product or live infrastructure was modified

## Reproduced findings

The exact `services/control-plane/src/authorization.mjs` source was streamed from
the immutable product commit into
`tests/security/S05-003-authorization-review.mjs`. The command reproduced six
fail-open cases:

- `CP-AUTH-001`: missing resolved resource tenant identity returns `ALLOWED`.
- `CP-AUTH-002`: missing resolved target tenant identity returns `ALLOWED`.
- `CP-AUTH-003`: missing host IDs pass the `undefined === undefined` pairing-host check.
- `CP-AUTH-004`: missing actor and pairing membership IDs pass the same equality check.
- `CP-AUTH-005`: `pairing_id` is required by the OpenAPI request but is not required/consumed by the reference authorization function.
- `CP-AUTH-006`: an owner role mutation target with no tenant or membership identity returns `ALLOWED`.

The exact `infrastructure/database/migrations/0001_control_plane.sql` source was
streamed into `tests/security/Test-S05-003-migration-review.ps1`. Forced RLS and
composite tenant foreign keys were present, but the review reproduced:

- `CP-DB-001`: no database-level final-owner invariant exists in
  `role_assignments`; final-owner safety relies on caller-supplied
  `activeOwnerCount`, leaving stale-count/concurrent revocation risk.

## Requested remediation and tests

1. Require complete identity-bearing authorization inputs. Missing tenant IDs,
   membership IDs, host IDs, pairing IDs, device-key IDs, and entitlement keys
   must fail closed before permission evaluation.
2. Resolve and bind the exact tenant-scoped pairing row identified by `pairing_id`.
3. Enforce final-owner preservation transactionally and at the database boundary;
   do not trust a caller-supplied owner count.
4. Add regression tests for all seven IDs above, including stale/concurrent owner
   revocation attempts.

The full report and exact commands are in
`docs/security/S05-003-control-plane-review.md`.
