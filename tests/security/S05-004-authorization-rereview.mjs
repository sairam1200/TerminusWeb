import assert from "node:assert/strict";
const source = await new Promise((resolve) => { let s = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (c) => { s += c; }); process.stdin.on("end", () => resolve(s)); });
const { authorize } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const A="11111111-1111-4111-8111-111111111111", B="22222222-2222-4222-8222-222222222222", M="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", H="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", P="cccccccc-cccc-4ccc-8ccc-cccccccccccc", D="dddddddd-dddd-4ddd-8ddd-dddddddddddd", N=2000000000;
const actor={authenticated:true,tenantId:A,membershipId:M,membershipState:"active",roles:["operator"],entitlements:["terminal_access"],availableQuotaUnits:10};
const resource={tenantId:A,hostId:H,deviceKeyId:D,hostState:"active",deviceKeyState:"active",deviceKeyValidAfterEpochSeconds:N-60,deviceKeyExpiresAtEpochSeconds:N+60};
const target={tenantId:A,pairingId:P,pairingState:"confirmed",pairingMembershipId:M,pairingHostId:H,pairingExpiresAtEpochSeconds:N+60,entitlementKey:"terminal_access",entitlementState:"active",entitlementStartsAtEpochSeconds:N-60,entitlementEndsAtEpochSeconds:null,requestedQuotaUnits:1,requestedTtlSeconds:300};
const lease=(o={})=>({actor,requestTenantId:A,action:"lease.issue",requestedPairingId:P,evaluatedAtEpochSeconds:N,resource,target,...o});
assert.deepEqual(authorize(lease()),{allowed:true,code:"ALLOWED",status:200});
const cases=[
 ["CP-AUTH-001",lease({resource:{...resource,tenantId:undefined}})],
 ["CP-AUTH-002",lease({target:{...target,tenantId:undefined}})],
 ["CP-AUTH-003",lease({resource:{...resource,hostId:undefined},target:{...target,pairingHostId:undefined}})],
 ["CP-AUTH-004",lease({actor:{...actor,membershipId:undefined},target:{...target,pairingMembershipId:undefined}})],
 ["CP-AUTH-005",lease({requestedPairingId:undefined})],
 ["CP-AUTH-006",{actor:{...actor,roles:["owner"]},requestTenantId:A,action:"role.assign",target:{membershipState:"active",role:"operator"}}],
 ["CROSS-TENANT-RESOURCE",lease({resource:{...resource,tenantId:B}})],
 ["CROSS-TENANT-TARGET",lease({target:{...target,tenantId:B}})]
];
for (const [id, req] of cases) { const result=authorize(req); assert.equal(result.allowed,false,`${id} unexpectedly allowed: ${JSON.stringify(result)}`); }
console.log(`PASS: repaired authorization rejects ${cases.length} identity/cross-tenant adversarial cases and preserves positive lease control.`);
