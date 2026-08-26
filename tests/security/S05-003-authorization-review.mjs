import assert from "node:assert/strict";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const source = Buffer.concat(chunks).toString("utf8");
assert.match(source, /export function authorize\s*\(/, "authorization source must be provided on stdin");

const { authorize } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const MEMBER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PAIRING_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = 2_000_000_000;

const actor = {
  authenticated: true,
  tenantId: TENANT_A,
  membershipId: MEMBER_A,
  membershipState: "active",
  roles: ["operator"],
  entitlements: ["terminal_access"],
  availableQuotaUnits: 10,
};

const resource = {
  tenantId: TENANT_A,
  hostId: HOST_A,
  hostState: "active",
  deviceKeyState: "active",
  deviceKeyValidAfterEpochSeconds: NOW - 60,
  deviceKeyExpiresAtEpochSeconds: NOW + 60,
};

const target = {
  tenantId: TENANT_A,
  pairingId: PAIRING_A,
  pairingState: "confirmed",
  pairingMembershipId: MEMBER_A,
  pairingHostId: HOST_A,
  pairingExpiresAtEpochSeconds: NOW + 60,
  entitlementState: "active",
  entitlementStartsAtEpochSeconds: NOW - 60,
  entitlementEndsAtEpochSeconds: null,
  requestedQuotaUnits: 1,
  requestedTtlSeconds: 300,
};

const leaseRequest = (overrides = {}) => ({
  actor,
  requestTenantId: TENANT_A,
  action: "lease.issue",
  evaluatedAtEpochSeconds: NOW,
  resource,
  target,
  ...overrides,
});

assert.deepEqual(authorize(leaseRequest()), { allowed: true, code: "ALLOWED", status: 200 });
assert.deepEqual(
  authorize(leaseRequest({ resource: { ...resource, tenantId: TENANT_B } })),
  { allowed: false, code: "NOT_FOUND", status: 404 },
);
assert.deepEqual(
  authorize(leaseRequest({ target: { ...target, tenantId: TENANT_B } })),
  { allowed: false, code: "NOT_FOUND", status: 404 },
);

const findings = [];
function expectDenied(id, request, detail) {
  const result = authorize(request);
  if (result.allowed) findings.push({ id, detail, result });
}

expectDenied(
  "CP-AUTH-001",
  leaseRequest({ resource: { ...resource, tenantId: undefined } }),
  "A lease is allowed when the resolved host/device resource has no tenant identity.",
);
expectDenied(
  "CP-AUTH-002",
  leaseRequest({ target: { ...target, tenantId: undefined } }),
  "A lease is allowed when the resolved pairing/entitlement target has no tenant identity.",
);
expectDenied(
  "CP-AUTH-003",
  leaseRequest({
    resource: { ...resource, hostId: undefined },
    target: { ...target, pairingHostId: undefined },
  }),
  "A lease is allowed when host identity is absent; undefined equals undefined in the pairing-host check.",
);
expectDenied(
  "CP-AUTH-004",
  leaseRequest({
    actor: { ...actor, membershipId: undefined },
    target: { ...target, pairingMembershipId: undefined },
  }),
  "A lease is allowed when actor and pairing membership identities are both absent.",
);
expectDenied(
  "CP-AUTH-005",
  leaseRequest({ target: { ...target, pairingId: undefined } }),
  "A lease is allowed without a concrete pairing identifier even though the API contract requires pairing_id.",
);
expectDenied(
  "CP-AUTH-006",
  {
    actor: { ...actor, roles: ["owner"] },
    requestTenantId: TENANT_A,
    action: "role.assign",
    target: { membershipState: "active", role: "operator" },
  },
  "An owner role mutation is allowed without target tenant and membership identity.",
);

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`FINDING ${finding.id}: ${finding.detail}`);
    console.error(`  observed: ${JSON.stringify(finding.result)}`);
  }
  console.error(`S05-003 authorization review reproduced ${findings.length} fail-open case(s).`);
  process.exitCode = 1;
} else {
  console.log("PASS: all S05-003 authorization negative cases were rejected.");
}
