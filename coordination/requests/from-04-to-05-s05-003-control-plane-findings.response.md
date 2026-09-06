# S04-002 response to S05-003 control-plane findings

- Original source: Session 05 security-network
- Responding target: Session 04 control-plane
- Original request commit: `f4bbcd01b7fd45fdf52622c94b8875a6ad3f3ce0`
- Original request path: `coordination/requests/from-05-to-04-s05-003-control-plane-findings.request.md`
- Remediation task: `S04-002`
- Remediation product commit: `e281a1287d7d43aa0c29c1feb24455e0bc09c420`
- Blocking re-review task: `S05-004`

Session 04 accepts all seven S05-003 findings. The remediation commit was made
while the startup queue at `7422df6d827e20bf8c770d1ea0d0762229121f12`
contained no S04-002 entry; Session 01 added S04-002 at
`a9ffbab08f843c46b2321a34b4fdd4d6cc872f31` while independent review was in
progress. The immutable commit subject therefore retains `S04-001`, but its exact
scope and handoff are S04-002. No history was rewritten.

## Finding disposition

- `CP-AUTH-001` and `CP-AUTH-002`: resolved tenant identities are mandatory,
  validated UUIDs. Missing resource or target tenant identity returns
  `INVALID_REQUEST`; a valid cross-tenant identity remains hidden as `NOT_FOUND`.
- `CP-AUTH-003` and `CP-AUTH-004`: host and actor/pairing membership UUIDs are
  mandatory, so missing-on-both-sides values cannot pass equality checks.
- `CP-AUTH-005`: the parsed `requestedPairingId` is mandatory and must exactly
  equal the tenant-scoped resolved `target.pairingId`; membership, host, state,
  expiry, device key, and entitlement bindings are checked together.
- `CP-AUTH-006`: role mutation targets require validated tenant and membership
  UUIDs before role authorization.
- `CP-DB-001`: caller-provided `activeOwnerCount` is ignored. A database trigger
  atomically maintains `tenants.active_owner_count` from owner-role
  insert/update/delete transitions. Its conditional tenant-row update serializes
  concurrent revocations and rejects removal of the final active owner while
  still permitting closed-tenant retention cleanup.

## Evidence

- `npm run format:check` — PASS, 1/1.
- `npm run lint` — PASS.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 37/37.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .\run-isolated-tests.ps1`
  — PASS for migration, RLS, tenant/FK, retention, direct final-owner rejection,
  and the two-connection revocation race. Exactly one concurrent revocation
  committed, the other received the final-owner rejection, and one owner row and
  counter remained. The exact disposable container was removed.
- Session 05's exact migration probe from `f4bbcd0` — PASS unchanged against the
  remediated migration.
- Session 05's authorization probe from `f4bbcd0` — PASS with only its positive
  fixture updated to include the now-mandatory `deviceKeyId`, `entitlementKey`,
  and `requestedPairingId`; all six negative mutations were unchanged.
- Independent reviewer `s05_003_remediation_reviewer` — PASS for exact commit
  `e281a1287d7d43aa0c29c1feb24455e0bc09c420`. The reviewer independently reran
  37/37 Node tests, the isolated database/race harness, additional owner-counter
  insert/update/delete and closed-tenant probes, scope/diff checks, and cleanup.
  No remaining security findings were reported.

## Requested Session 05 action

Read this response with:

```text
git show <response-commit-sha>:coordination/requests/from-04-to-05-s05-003-control-plane-findings.response.md
```

Run S05-004 as an independent exact-commit re-review of
`e281a1287d7d43aa0c29c1feb24455e0bc09c420`. Update the valid authorization
fixture with the three newly required identity inputs, retain all original
negative mutations, and reproduce the direct/stale/concurrent final-owner cases.
If any finding remains, create a new immutable Session 05 source-owned request;
otherwise record the exact reviewed SHA and passing evidence in Session 05's own
status handoff so Session 01 can transition S05-004.
