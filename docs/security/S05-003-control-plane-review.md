# S05-003 independent control-plane review

Review target: Session 04 S04-001 product tip
`83d110aa3f0bf582f811ce6922234f2183b2b93d` (resolved full SHA:
`83d110aa3f0bf582f811ce6922234f2183b2b93d`). The Session 04 owner status marks
this product `done`; the handoff branch tip is `f1adc0afbb0b59b6c1a64b2cc1f9c49d90c74bb7`.

This review is independent and read-only with respect to Session 04. No Session 04
product file, database, control plane, or live infrastructure was modified.

## Scope and evidence

Reviewed at the exact product SHA:

- `services/control-plane/src/authorization.mjs`
- `services/control-plane/test/authorization.test.mjs`
- `services/control-plane/test/contracts.test.mjs`
- `services/control-plane/contracts/domain-model.json`
- `services/control-plane/contracts/openapi.json`
- `infrastructure/database/migrations/0001_control_plane.sql`
- `infrastructure/database/test/001_invariants.sql`

The product’s existing tests cover explicit cross-tenant mismatches, RLS, composite
foreign keys, admin role restrictions, and final-owner behavior when the caller
supplies a correct `activeOwnerCount`. This review adds malformed/incomplete
authorization inputs and a database-level owner-invariant check that were not in
those tests.

Run the exact-source authorization review without copying or modifying Session 04
code:

```powershell
git show 83d110aa3f0bf582f811ce6922234f2183b2b93d:services/control-plane/src/authorization.mjs |
  node tests/security/S05-003-authorization-review.mjs
```

Run the exact migration review without copying or modifying the migration:

```powershell
git show 83d110aa3f0bf582f811ce6922234f2183b2b93d:infrastructure/database/migrations/0001_control_plane.sql |
  powershell -NoProfile -ExecutionPolicy Bypass -File tests/security/Test-S05-003-migration-review.ps1
```

The authorization command is expected to exit non-zero until the findings are
fixed; its non-zero result is the reproduced security evidence, not a claimed pass.
The migration command is also expected to expose the missing owner invariant. The
existing Session 04 disposable PostgreSQL PASS was not treated as independent proof
of these additional cases.

## Findings

### CP-AUTH-001 — missing resolved-resource tenant identity is fail-open

Severity: High. Reproduction: start from the product’s valid same-tenant lease
fixture, remove `resource.tenantId`, and call `authorize`. The result is
`{allowed:true, code:"ALLOWED", status:200}`. The function only rejects a resource
tenant when the optional field is present. This violates the domain invariant that
every tenant object reference carries and matches `tenant_id`, and it allows a
malformed or incorrectly mapped host/device object to pass tenant authorization.

### CP-AUTH-002 — missing resolved-target tenant identity is fail-open

Severity: High. Removing `target.tenantId` likewise returns `ALLOWED`. Pairing,
entitlement, and lease target objects must be tenant-bound and missing context must
fail closed, not be treated as “no mismatch.”

### CP-AUTH-003 — missing host identity passes the pairing binding

Severity: High. Removing both `resource.hostId` and `target.pairingHostId` returns
`ALLOWED` because the equality guard compares `undefined` to `undefined`. A lease
can therefore be authorized without a concrete host identity, violating the
single-private-host audience and pairing-to-host binding.

### CP-AUTH-004 — missing membership identity passes the pairing binding

Severity: High. Removing `actor.membershipId` and `target.pairingMembershipId`
returns `ALLOWED` for the same reason. A lease must never be authorized without a
concrete actor membership and matching confirmed pairing.

### CP-AUTH-005 — pairing identifier is not required by the reference policy

Severity: Medium/High. The OpenAPI `LeaseRequest` requires `pairing_id`, but the
reference authorization function does not consume or require a pairing identifier.
Removing the internal `target.pairingId` field still returns `ALLOWED`. The eventual
handler must resolve a tenant-scoped, active pairing by the request ID and pass a
complete identity-bearing object to authorization; otherwise an active state tuple
could be detached from the requested pairing row.

### CP-AUTH-006 — role mutation target identity is not required

Severity: High. An owner can receive `ALLOWED` for `role.assign` with a target that
contains only `{membershipState:"active", role:"operator"}`—no target tenant or
membership ID. This violates the same-tenant active-membership invariant and could
authorize an operation before a concrete target is resolved.

### CP-DB-001 — final-owner protection is not enforced in the database

Severity: High. `authorizeRoleMutation` trusts caller-supplied `target.activeOwnerCount`
to prevent revoking the final owner, but `role_assignments` has no database trigger,
constraint, or transactional owner-count guard. The independent migration review
reports this absence. Two concurrent role changes or stale count data can therefore
leave a tenant with no active owner even though the reference unit test passes with
hand-authored `activeOwnerCount: 1`.

## Required remediation proposals

These are source-owned requests for Session 04, not edits made by Session 05:

1. Make authorization inputs closed and identity-bearing. Require non-empty,
   validated tenant IDs on every resource and target, require actor membership ID,
   target membership ID, host ID, pairing ID, device-key ID, and entitlement key
   where each is semantically required. Missing identifiers must return a safe
   rejection (`INVALID_REQUEST` for malformed internal input or `NOT_FOUND` at the
   object boundary), never `ALLOWED`.
2. Bind lease authorization to the exact tenant-scoped pairing row identified by
   `pairing_id`; verify its membership, host, state, expiry, and tenant together.
3. Enforce final-owner preservation transactionally in the role mutation path and at
   the database boundary. The check must lock/re-evaluate active owners in the same
   transaction as revocation; a caller-provided count is not authoritative.
4. Add regression tests for every CP-AUTH and CP-DB case, including concurrent or
   stale owner-count attempts, before the control-plane contract can be considered
   independently secure.

## Boundary and non-findings

- The SQL review confirms the migration contains forced RLS for tenant tables and
  composite tenant foreign keys. These are positive controls, not proof that the
  application authorization layer is complete.
- The control plane remains documented as metadata-only; no terminal stream relay,
  terminal plaintext, or universal decryption key was found in the reviewed files.
- No live infrastructure, deployed endpoint, database, Tailscale state, or Session
  04 product code was accessed or changed.
