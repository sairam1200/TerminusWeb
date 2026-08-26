import assert from "node:assert/strict";
import test from "node:test";

import { authorize, authorizeProviderAction, policy } from "../src/authorization.mjs";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = 2_000_000_000;

function actor(overrides = {}) {
  return {
    authenticated: true,
    tenantId: TENANT_A,
    membershipId: MEMBER_A,
    membershipState: "active",
    roles: ["operator"],
    entitlements: ["terminal_access"],
    availableQuotaUnits: 10,
    ...overrides
  };
}

function leaseRequest(overrides = {}) {
  return {
    actor: actor(),
    requestTenantId: TENANT_A,
    action: "lease.issue",
    evaluatedAtEpochSeconds: NOW,
    resource: {
      tenantId: TENANT_A,
      hostId: HOST_A,
      hostState: "active",
      deviceKeyState: "active",
      deviceKeyValidAfterEpochSeconds: NOW - 60,
      deviceKeyExpiresAtEpochSeconds: NOW + 60
    },
    target: {
      tenantId: TENANT_A,
      pairingState: "confirmed",
      pairingMembershipId: MEMBER_A,
      pairingHostId: HOST_A,
      pairingExpiresAtEpochSeconds: NOW + 60,
      entitlementState: "active",
      entitlementStartsAtEpochSeconds: NOW - 60,
      entitlementEndsAtEpochSeconds: null,
      requestedQuotaUnits: 1,
      requestedTtlSeconds: 300
    },
    ...overrides
  };
}

test("positive: an entitled operator can request a same-tenant lease", () => {
  assert.deepEqual(authorize(leaseRequest()), { allowed: true, code: "ALLOWED", status: 200 });
});

test("negative: missing authentication fails before tenant lookup", () => {
  const request = leaseRequest({ actor: { authenticated: false } });
  assert.deepEqual(authorize(request), { allowed: false, code: "UNAUTHENTICATED", status: 401 });
});

test("negative: actor tenant mismatch is hidden as not found", () => {
  const request = leaseRequest({ requestTenantId: TENANT_B });
  assert.deepEqual(authorize(request), { allowed: false, code: "NOT_FOUND", status: 404 });
});

test("negative: cross-tenant host reference is hidden as not found", () => {
  const request = leaseRequest({
    resource: { tenantId: TENANT_B, hostId: HOST_A, hostState: "active", deviceKeyState: "active" }
  });
  assert.deepEqual(authorize(request), { allowed: false, code: "NOT_FOUND", status: 404 });
});

test("negative: cross-tenant target reference is hidden as not found", () => {
  const request = leaseRequest({ target: { ...leaseRequest().target, tenantId: TENANT_B } });
  assert.deepEqual(authorize(request), { allowed: false, code: "NOT_FOUND", status: 404 });
});

test("negative: suspended membership and closed tenant fail closed", () => {
  const suspended = leaseRequest({ actor: actor({ membershipState: "suspended" }) });
  assert.equal(authorize(suspended).code, "FORBIDDEN");

  const closed = leaseRequest({ tenantState: "closed" });
  assert.equal(authorize(closed).code, "FORBIDDEN");
});

test("role and entitlement are independent: owner without entitlement cannot issue", () => {
  const request = leaseRequest({ actor: actor({ roles: ["owner"], entitlements: [] }) });
  assert.deepEqual(authorize(request), { allowed: false, code: "FORBIDDEN", status: 403 });
});

test("role and quota are independent: owner without quota cannot issue", () => {
  const request = leaseRequest({ actor: actor({ roles: ["owner"], availableQuotaUnits: 0 }) });
  assert.deepEqual(authorize(request), { allowed: false, code: "CONFLICT", status: 409 });
});

test("lease requires matching confirmed pairing, active host, and active device key", () => {
  const cases = [
    leaseRequest({ target: { ...leaseRequest().target, pairingState: "pending" } }),
    leaseRequest({ target: { ...leaseRequest().target, pairingMembershipId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } }),
    leaseRequest({ target: { ...leaseRequest().target, pairingHostId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } }),
    leaseRequest({ resource: { ...leaseRequest().resource, hostState: "disabled" } }),
    leaseRequest({ resource: { ...leaseRequest().resource, deviceKeyState: "revoked" } })
  ];

  for (const request of cases) {
    assert.equal(authorize(request).allowed, false);
  }
});

test("boundary: lease lifetime is one through 300 seconds", () => {
  assert.equal(authorize(leaseRequest({ target: { ...leaseRequest().target, requestedTtlSeconds: 1 } })).allowed, true);
  assert.equal(authorize(leaseRequest({ target: { ...leaseRequest().target, requestedTtlSeconds: 300 } })).allowed, true);
  assert.equal(authorize(leaseRequest({ target: { ...leaseRequest().target, requestedTtlSeconds: 0 } })).code, "INVALID_REQUEST");
  assert.equal(authorize(leaseRequest({ target: { ...leaseRequest().target, requestedTtlSeconds: 301 } })).code, "INVALID_REQUEST");
  for (const requestedTtlSeconds of [undefined, "300", Number.NaN]) {
    assert.equal(authorize(leaseRequest({ target: { ...leaseRequest().target, requestedTtlSeconds } })).code, "INVALID_REQUEST");
  }
  assert.equal(policy.maximumLeaseLifetimeSeconds, 300);
});

test("boundary: quota units must be a positive safe integer and available", () => {
  for (const requestedQuotaUnits of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const result = authorize(leaseRequest({ target: { ...leaseRequest().target, requestedQuotaUnits } }));
    assert.equal(result.code, "INVALID_REQUEST");
  }

  const unavailable = leaseRequest({ target: { ...leaseRequest().target, requestedQuotaUnits: 11 } });
  assert.equal(authorize(unavailable).code, "CONFLICT");
});

test("positive: owner can assign owner to an active same-tenant member", () => {
  const result = authorize({
    actor: actor({ roles: ["owner"] }),
    requestTenantId: TENANT_A,
    action: "role.assign",
    target: { tenantId: TENANT_A, membershipState: "active", role: "owner" }
  });
  assert.equal(result.allowed, true);
});

test("privilege escalation: admin cannot grant or revoke owner/admin", () => {
  for (const action of ["role.assign", "role.revoke"]) {
    for (const role of ["owner", "admin"]) {
      const result = authorize({
        actor: actor({ roles: ["admin"] }),
        requestTenantId: TENANT_A,
        action,
        target: { tenantId: TENANT_A, membershipState: "active", role, activeOwnerCount: 2 }
      });
      assert.deepEqual(result, { allowed: false, code: "FORBIDDEN", status: 403 });
    }
  }
});

test("positive: admin can manage operator and auditor roles only", () => {
  for (const action of ["role.assign", "role.revoke"]) {
    for (const role of ["operator", "auditor"]) {
      const result = authorize({
        actor: actor({ roles: ["admin"] }),
        requestTenantId: TENANT_A,
        action,
        target: { tenantId: TENANT_A, membershipState: "active", role, activeOwnerCount: 2 }
      });
      assert.equal(result.allowed, true);
    }
  }
});

test("privilege escalation: final owner cannot be revoked", () => {
  const result = authorize({
    actor: actor({ roles: ["owner"] }),
    requestTenantId: TENANT_A,
    action: "role.revoke",
    target: { tenantId: TENANT_A, membershipState: "active", role: "owner", activeOwnerCount: 1 }
  });
  assert.deepEqual(result, { allowed: false, code: "CONFLICT", status: 409 });
});

test("positive: owner can revoke one owner when another active owner remains", () => {
  const result = authorize({
    actor: actor({ roles: ["owner"] }),
    requestTenantId: TENANT_A,
    action: "role.revoke",
    target: { tenantId: TENANT_A, membershipState: "active", role: "owner", activeOwnerCount: 2 }
  });
  assert.equal(result.allowed, true);
});

test("privilege escalation: final-owner count must be a positive safe integer", () => {
  for (const activeOwnerCount of [undefined, Number.NaN, 0, 1.5]) {
    const result = authorize({
      actor: actor({ roles: ["owner"] }),
      requestTenantId: TENANT_A,
      action: "role.revoke",
      target: { tenantId: TENANT_A, membershipState: "active", role: "owner", activeOwnerCount }
    });
    assert.deepEqual(result, { allowed: false, code: "INVALID_REQUEST", status: 422 });
  }
});

test("expired or not-yet-valid lease prerequisites fail closed", () => {
  const cases = [
    leaseRequest({ target: { ...leaseRequest().target, pairingExpiresAtEpochSeconds: NOW } }),
    leaseRequest({ resource: { ...leaseRequest().resource, deviceKeyValidAfterEpochSeconds: NOW + 1 } }),
    leaseRequest({ resource: { ...leaseRequest().resource, deviceKeyExpiresAtEpochSeconds: NOW } }),
    leaseRequest({ target: { ...leaseRequest().target, entitlementState: "expired" } }),
    leaseRequest({ target: { ...leaseRequest().target, entitlementStartsAtEpochSeconds: NOW + 1 } }),
    leaseRequest({ target: { ...leaseRequest().target, entitlementEndsAtEpochSeconds: NOW } })
  ];
  for (const request of cases) {
    assert.equal(authorize(request).allowed, false);
  }
});

test("boundary: lease prerequisites are valid at inclusive starts and before exclusive expiries", () => {
  const request = leaseRequest({
    resource: {
      ...leaseRequest().resource,
      deviceKeyValidAfterEpochSeconds: NOW,
      deviceKeyExpiresAtEpochSeconds: NOW + 1
    },
    target: {
      ...leaseRequest().target,
      pairingExpiresAtEpochSeconds: NOW + 1,
      entitlementStartsAtEpochSeconds: NOW,
      entitlementEndsAtEpochSeconds: NOW + 1
    }
  });
  assert.equal(authorize(request).allowed, true);
});

test("missing or malformed lease prerequisite timestamps fail closed", () => {
  const cases = [
    leaseRequest({ evaluatedAtEpochSeconds: undefined }),
    leaseRequest({ target: { ...leaseRequest().target, pairingExpiresAtEpochSeconds: "later" } }),
    leaseRequest({ resource: { ...leaseRequest().resource, deviceKeyValidAfterEpochSeconds: Number.NaN } }),
    leaseRequest({ resource: { ...leaseRequest().resource, deviceKeyExpiresAtEpochSeconds: undefined } }),
    leaseRequest({ target: { ...leaseRequest().target, entitlementStartsAtEpochSeconds: undefined } }),
    leaseRequest({ target: { ...leaseRequest().target, entitlementEndsAtEpochSeconds: "never" } })
  ];
  for (const request of cases) {
    assert.deepEqual(authorize(request), { allowed: false, code: "INVALID_REQUEST", status: 422 });
  }
});

test("privilege escalation: inactive or unknown role target is invalid", () => {
  for (const target of [
    { tenantId: TENANT_A, membershipState: "suspended", role: "operator" },
    { tenantId: TENANT_A, membershipState: "active", role: "superadmin" }
  ]) {
    const result = authorize({
      actor: actor({ roles: ["owner"] }),
      requestTenantId: TENANT_A,
      action: "role.assign",
      target
    });
    assert.equal(result.code, "INVALID_REQUEST");
  }
});

test("human roles can never synchronize subscription state", () => {
  const result = authorize({
    actor: actor({ roles: ["owner", "admin"] }),
    requestTenantId: TENANT_A,
    action: "subscription.sync"
  });
  assert.deepEqual(result, { allowed: false, code: "FORBIDDEN", status: 403 });
});

test("provider adapter remains disabled until commercial activation is approved", () => {
  const principal = { authenticated: true, kind: "provider_adapter" };
  assert.equal(authorizeProviderAction({ principal, action: "subscription.sync", commercialActivation: "disabled" }).allowed, false);
  assert.equal(authorizeProviderAction({ principal, action: "subscription.sync", commercialActivation: "approved" }).allowed, true);
  assert.equal(authorizeProviderAction({ principal: actor({ roles: ["owner"] }), action: "subscription.sync", commercialActivation: "approved" }).allowed, false);
});
