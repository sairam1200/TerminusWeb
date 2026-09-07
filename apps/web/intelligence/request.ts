import { isUuidV4 } from "../protocol/codec";
const empty = new Set([
  "session.current",
  "history.delete",
  "analytics.delete",
  "guest.delete",
  "usage.get",
  "account.logout",
  "billing.get",
  "admin.overview",
]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number, min = 0) =>
  typeof value === "string" && value.length >= min && value.length <= max;
function fields(
  params: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
) {
  return (
    required.every((k) => k in params) &&
    Object.keys(params).every(
      (k) => required.includes(k) || optional.includes(k),
    )
  );
}
export function validRequest(value: unknown): boolean {
  if (
    !object(value) ||
    !fields(value, ["type", "id", "method", "params"]) ||
    value.type !== "request" ||
    !isUuidV4(value.id) ||
    typeof value.method !== "string" ||
    !object(value.params)
  )
    return false;
  const p = value.params;
  if (empty.has(value.method)) return fields(p, []);
  switch (value.method) {
    case "data.export":
      return (
        fields(p, [], ["cursor"]) &&
        (p.cursor === undefined || isUuidV4(p.cursor))
      );
    case "privacy.update":
      return (
        fields(p, ["history", "analytics", "personalization"]) &&
        typeof p.history === "boolean" &&
        typeof p.analytics === "boolean" &&
        typeof p.personalization === "boolean" &&
        (!p.personalization || p.history)
      );
    case "command.record":
      return (
        fields(p, ["eventId", "command"]) &&
        isUuidV4(p.eventId) &&
        typeof p.command === "string" &&
        p.command.trim().length > 0 &&
        new TextEncoder().encode(p.command).length <= 4096 &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(p.command)
      );
    case "history.list":
      return (
        fields(p, [], ["query", "category", "limit"]) &&
        (p.query === undefined || text(p.query, 256)) &&
        (p.category === undefined || text(p.category, 64)) &&
        (p.limit === undefined ||
          (typeof p.limit === "number" &&
            Number.isInteger(p.limit) &&
            p.limit >= 1 &&
            p.limit <= 100))
      );
    case "recommendations.get":
      return (
        fields(p, [], ["query"]) &&
        (p.query === undefined || text(p.query, 256))
      );
    case "recommendation.click":
      return fields(p, ["id"]) && text(p.id, 128, 1);
    case "terminal.record":
      return (
        fields(p, ["eventId", "state"]) &&
        isUuidV4(p.eventId) &&
        ["connected", "disconnected", "reconnecting"].includes(
          p.state as string,
        )
      );
    case "account.login":
    case "account.register":
      return (
        fields(
          p,
          value.method === "account.login"
            ? ["email", "password"]
            : ["email", "password", "name"],
        ) &&
        text(p.email, 320, 3) &&
        typeof p.password === "string" &&
        new TextEncoder().encode(p.password).length >= 12 &&
        new TextEncoder().encode(p.password).length <= 1024 &&
        (value.method !== "account.register" || text(p.name, 120, 1))
      );
    default:
      return false;
  }
}
