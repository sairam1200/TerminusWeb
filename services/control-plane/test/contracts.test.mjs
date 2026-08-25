import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domain = JSON.parse(await readFile(new URL("../contracts/domain-model.json", import.meta.url), "utf8"));
const openapi = JSON.parse(await readFile(new URL("../contracts/openapi.json", import.meta.url), "utf8"));
const lease = JSON.parse(await readFile(new URL("../contracts/lease-claims.schema.json", import.meta.url), "utf8"));
const migration = await readFile(new URL("../../../infrastructure/database/migrations/0001_control_plane.sql", import.meta.url), "utf8");

const TENANT_ENTITIES = [
  "memberships",
  "role_assignments",
  "hosts",
  "device_keys",
  "pairings",
  "entitlement_grants",
  "quota_ledger",
  "leases",
  "subscriptions",
  "audit_events"
];

test("contract is explicitly inactive and metadata-only", () => {
  assert.equal(domain.status, "proposed-inactive");
  assert.equal(domain.boundary, "metadata-only-control-plane");
  assert.equal(domain.commercialActivation, "disabled");
  assert.equal(openapi["x-terminus-boundary"], "metadata-only");
  assert.equal(openapi["x-terminus-commercial-activation"], "disabled");
  assert.equal(openapi.servers, undefined, "inactive contract must not advertise a deployable server");
});

test("all required domain entities exist and tenant entities use composite identifiers", () => {
  const required = ["accounts", "tenants", ...TENANT_ENTITIES];
  assert.deepEqual(Object.keys(domain.entities).sort(), required.sort());
  for (const name of TENANT_ENTITIES) {
    assert.equal(domain.entities[name].scope, "tenant", `${name} must be tenant scoped`);
    assert.deepEqual(domain.entities[name].identifiers.slice(0, 2), ["tenant_id", "id"]);
  }
});

test("role, entitlement, quota, and subscription concepts stay structurally separate", () => {
  assert.deepEqual(domain.entities.role_assignments.values, ["owner", "admin", "operator", "auditor"]);
  assert.equal(domain.entities.role_assignments.references.includes("entitlement_catalog"), false);
  assert.equal(domain.entities.entitlement_grants.references.includes("role_assignments"), false);
  assert.match(domain.entities.subscriptions.purpose, /^Inactive /);
  assert.ok(domain.authorizationInvariants.some((rule) => rule.includes("Roles never imply")));
});

test("data map explicitly excludes sensitive terminal and secret material", () => {
  const forbidden = new Set(domain.dataMap.forbidden);
  for (const item of [
    "terminal input",
    "terminal output",
    "commands",
    "clipboard contents",
    "shell environment",
    "private device keys",
    "control-plane signing keys",
    "reusable pairing secrets",
    "free-form audit payloads"
  ]) {
    assert.equal(forbidden.has(item), true, `missing forbidden data category: ${item}`);
  }
});

test("lease claims are closed, bounded, metadata-only, and single-target", () => {
  assert.equal(lease.additionalProperties, false);
  assert.equal(lease["x-terminus-invariants"].maximumLifetimeSeconds, 300);
  assert.equal(lease["x-terminus-invariants"].terminalPayloadAllowed, false);
  assert.equal(lease.properties.entitlement.const, "terminal_access");
  assert.equal(lease.properties.audience.$ref, "#/$defs/uuid");
  assert.equal(lease.properties.subject.$ref, "#/$defs/uuid");

  const propertyNames = Object.keys(lease.properties);
  for (const forbidden of ["input", "output", "command", "clipboard", "environment", "stream", "decryption_key"] ) {
    assert.equal(propertyNames.includes(forbidden), false, `lease must not carry ${forbidden}`);
  }
});

test("every tenant API operation declares cross-tenant not-found behavior", () => {
  const tenantPaths = Object.entries(openapi.paths).filter(([path]) => path.startsWith("/v1/tenants/{tenantId}"));
  assert.ok(tenantPaths.length > 0);
  for (const [path, pathItem] of tenantPaths) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (method === "parameters") continue;
      assert.equal(operation["x-terminus-cross-tenant-response"], 404, `${method.toUpperCase()} ${path}`);
      assert.ok(operation.responses["401"], `${method.toUpperCase()} ${path} must define 401`);
      assert.ok(operation.responses["403"], `${method.toUpperCase()} ${path} must define 403`);
      assert.ok(operation.responses["404"], `${method.toUpperCase()} ${path} must define 404`);
    }
  }
});

test("mutation request schemas reject unknown fields", () => {
  for (const schemaName of ["PairingRequest", "LeaseRequest", "SubscriptionState"]) {
    assert.equal(openapi.components.schemas[schemaName].additionalProperties, false, schemaName);
  }
  assert.equal(openapi.components.schemas.LeaseRequest.properties.ttl_seconds.maximum, 300);
});

test("subscription synchronization is internal, non-human, and disabled", () => {
  const operation = openapi.paths["/v1/internal/subscription-state"].post;
  assert.deepEqual(operation.security, [{ providerAdapter: [] }]);
  assert.equal(operation["x-terminus-human-role-authorized"], false);
  assert.equal(operation["x-terminus-commercial-activation"], "disabled");
});

test("migration defines one tenant RLS policy and composite tenant references", () => {
  for (const table of ["tenants", ...TENANT_ENTITIES]) {
    assert.match(migration, new RegExp(`ALTER TABLE terminus_cp\\.${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(migration, new RegExp(`ALTER TABLE terminus_cp\\.${table} FORCE ROW LEVEL SECURITY;`));
  }

  assert.match(migration, /FOREIGN KEY \(tenant_id, host_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, membership_id\)/);
  assert.match(migration, /FOREIGN KEY \(tenant_id, pairing_id, membership_id, host_id\)/);
  assert.match(migration, /current_setting\('terminus\.tenant_id', true\)/);
});

test("migration has no free-form audit payload or terminal-content columns", () => {
  const normalized = migration.toLowerCase();
  for (const forbiddenColumn of ["command text", "input text", "output text", "clipboard text", "payload json", "payload jsonb", "environment json", "environment jsonb"]) {
    assert.equal(normalized.includes(forbiddenColumn), false, forbiddenColumn);
  }
  assert.match(normalized, /create table terminus_cp\.audit_events/);
  assert.equal(/create table terminus_cp\.audit_events[\s\S]*?\b(json|jsonb)\b[\s\S]*?;/.test(normalized), false);
});
