# S05-004 exact-SHA control-plane re-review

Independent read-only review of S04-002 remediation.

- Queue: Session 01 commit `ed4cc9bd6aad6bd36373eeaa36775b1d8df2c397`; S05-004 was ready.
- Immutable S04 response: `2bb9f0b10f2b77e3c9aa1c25facffd10002328cd`.
- Exact remediation product: `e281a1287d7d43aa0c29c1feb24455e0bc09c420`.

## Results

The repaired authorization requires validated tenant, host, device-key, pairing, membership, entitlement, and requested-pairing identities. The six original CP-AUTH-001..006 mutations now fail closed (`INVALID_REQUEST` for missing identities); explicit cross-tenant resource and target references remain hidden as `NOT_FOUND`. The valid same-tenant entitled operator lease remains allowed.

The repaired migration includes `preserve_final_owner()` and its `BEFORE INSERT OR UPDATE OR DELETE` trigger. It ignores caller-supplied owner counts, atomically maintains `tenants.active_owner_count`, rejects stale final-owner removal, permits closed-tenant retention cleanup, and serializes concurrent revocations through the tenant-row update. Session 04's exact isolated harness evidence reports one commit and one final-owner rejection in the two-connection race; no terminal data is handled by this metadata-only control plane.

Command evidence:

```text
git show e281a1287d7d43aa0c29c1feb24455e0bc09c420:services/control-plane/src/authorization.mjs | node tests/security/S05-004-authorization-rereview.mjs
PASS: repaired authorization rejects 8 identity/cross-tenant adversarial cases and preserves positive lease control.

git show e281a1287d7d43aa0c29c1feb24455e0bc09c420:infrastructure/database/migrations/0001_control_plane.sql | powershell -NoProfile -ExecutionPolicy Bypass -File tests/security/Test-S05-003-migration-review.ps1
PASS: cross-tenant SQL isolation structures are present and final-owner invariant is enforced.
```

The response records Session 04's `npm test` 37/37 and isolated PostgreSQL direct/stale/concurrent owner-revocation checks. Those are handoff evidence, not rerun against live infrastructure here. No terminal plaintext, terminal relay, or decryption key appears in the reviewed product paths.
