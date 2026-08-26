const ROLE_PERMISSIONS = Object.freeze({
  owner: new Set([
    "membership.read",
    "role.assign",
    "role.revoke",
    "host.read",
    "host.manage",
    "device_key.manage",
    "pairing.create",
    "pairing.revoke",
    "lease.issue",
    "audit.read"
  ]),
  admin: new Set([
    "membership.read",
    "role.assign",
    "role.revoke",
    "host.read",
    "host.manage",
    "device_key.manage",
    "pairing.create",
    "pairing.revoke",
    "lease.issue",
    "audit.read"
  ]),
  operator: new Set(["host.read", "pairing.create", "pairing.revoke", "lease.issue"]),
  auditor: new Set(["host.read", "audit.read"])
});

const ADMIN_MANAGED_ROLES = new Set(["operator", "auditor"]);
const KNOWN_ROLES = new Set(Object.keys(ROLE_PERMISSIONS));

function decision(allowed, code, status) {
  return Object.freeze({ allowed, code, status });
}

const ALLOW = decision(true, "ALLOWED", 200);

export function authorize({ actor, requestTenantId, action, resource, target, tenantState = "active", evaluatedAtEpochSeconds }) {
  if (!actor?.authenticated) {
    return decision(false, "UNAUTHENTICATED", 401);
  }

  if (!requestTenantId || actor.tenantId !== requestTenantId) {
    return decision(false, "NOT_FOUND", 404);
  }

  if (resource?.tenantId !== undefined && resource.tenantId !== requestTenantId) {
    return decision(false, "NOT_FOUND", 404);
  }

  if (target?.tenantId !== undefined && target.tenantId !== requestTenantId) {
    return decision(false, "NOT_FOUND", 404);
  }

  if (actor.membershipState !== "active" || tenantState !== "active") {
    return decision(false, "FORBIDDEN", 403);
  }

  if (action === "subscription.sync") {
    return decision(false, "FORBIDDEN", 403);
  }

  const actorRoles = new Set((actor.roles ?? []).filter((role) => KNOWN_ROLES.has(role)));
  const hasPermission = [...actorRoles].some((role) => ROLE_PERMISSIONS[role].has(action));
  if (!hasPermission) {
    return decision(false, "FORBIDDEN", 403);
  }

  if (action === "role.assign" || action === "role.revoke") {
    return authorizeRoleMutation({ actorRoles, action, target });
  }

  if (action === "lease.issue") {
    return authorizeLease({ actor, resource, target, evaluatedAtEpochSeconds });
  }

  return ALLOW;
}

function authorizeRoleMutation({ actorRoles, action, target }) {
  if (target?.membershipState !== "active" || !KNOWN_ROLES.has(target?.role)) {
    return decision(false, "INVALID_REQUEST", 422);
  }

  const isOwner = actorRoles.has("owner");
  if (!isOwner && !ADMIN_MANAGED_ROLES.has(target.role)) {
    return decision(false, "FORBIDDEN", 403);
  }

  if (action === "role.revoke" && target.role === "owner") {
    if (!Number.isSafeInteger(target.activeOwnerCount) || target.activeOwnerCount < 1) {
      return decision(false, "INVALID_REQUEST", 422);
    }
    if (target.activeOwnerCount <= 1) {
      return decision(false, "CONFLICT", 409);
    }
  }

  return ALLOW;
}

function authorizeLease({ actor, resource, target, evaluatedAtEpochSeconds }) {
  if (
    !Number.isSafeInteger(target?.requestedTtlSeconds) ||
    target.requestedTtlSeconds < 1 ||
    target.requestedTtlSeconds > 300
  ) {
    return decision(false, "INVALID_REQUEST", 422);
  }

  if (!Number.isSafeInteger(target?.requestedQuotaUnits) || target.requestedQuotaUnits < 1) {
    return decision(false, "INVALID_REQUEST", 422);
  }

  const requiredTimes = [
    evaluatedAtEpochSeconds,
    target?.pairingExpiresAtEpochSeconds,
    resource?.deviceKeyValidAfterEpochSeconds,
    resource?.deviceKeyExpiresAtEpochSeconds,
    target?.entitlementStartsAtEpochSeconds
  ];
  if (!requiredTimes.every(Number.isSafeInteger)) {
    return decision(false, "INVALID_REQUEST", 422);
  }
  if (
    target.entitlementEndsAtEpochSeconds !== null &&
    !Number.isSafeInteger(target.entitlementEndsAtEpochSeconds)
  ) {
    return decision(false, "INVALID_REQUEST", 422);
  }

  if (
    resource?.hostState !== "active" ||
    resource?.deviceKeyState !== "active" ||
    resource.deviceKeyValidAfterEpochSeconds > evaluatedAtEpochSeconds ||
    resource.deviceKeyExpiresAtEpochSeconds <= evaluatedAtEpochSeconds
  ) {
    return decision(false, "CONFLICT", 409);
  }

  if (
    target?.pairingState !== "confirmed" ||
    target?.pairingMembershipId !== actor.membershipId ||
    target?.pairingHostId !== resource.hostId ||
    target.pairingExpiresAtEpochSeconds <= evaluatedAtEpochSeconds
  ) {
    return decision(false, "FORBIDDEN", 403);
  }

  const entitlements = new Set(actor.entitlements ?? []);
  if (
    !entitlements.has("terminal_access") ||
    target.entitlementState !== "active" ||
    target.entitlementStartsAtEpochSeconds > evaluatedAtEpochSeconds ||
    (target.entitlementEndsAtEpochSeconds !== null && target.entitlementEndsAtEpochSeconds <= evaluatedAtEpochSeconds)
  ) {
    return decision(false, "FORBIDDEN", 403);
  }

  if (!Number.isSafeInteger(actor.availableQuotaUnits) || actor.availableQuotaUnits < target.requestedQuotaUnits) {
    return decision(false, "CONFLICT", 409);
  }

  return ALLOW;
}

export function authorizeProviderAction({ principal, action, commercialActivation }) {
  if (!principal?.authenticated) {
    return decision(false, "UNAUTHENTICATED", 401);
  }
  if (action !== "subscription.sync" || principal.kind !== "provider_adapter") {
    return decision(false, "FORBIDDEN", 403);
  }
  if (commercialActivation !== "approved") {
    return decision(false, "FORBIDDEN", 403);
  }
  return ALLOW;
}

export const policy = Object.freeze({
  roles: Object.freeze([...KNOWN_ROLES]),
  maximumLeaseLifetimeSeconds: 300,
  commercialActivationDefault: "disabled"
});
