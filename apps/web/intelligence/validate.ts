import type { Rpc } from "./types";
import { isUuidV4 } from "../protocol/codec";
type Check = (v: unknown) => boolean;
const text: Check = (v) => typeof v === "string";
const integer: Check = (v) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const bool: Check = (v) => typeof v === "boolean";
const literal =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v);
const array =
  (check: Check, max = 10000): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
const object =
  (shape: Record<string, Check>): Check =>
  (v) =>
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.keys(v).length === Object.keys(shape).length &&
    Object.entries(shape).every(
      ([k, c]) => k in v && c((v as Record<string, unknown>)[k]),
    );
const user = object({ id: text, email: text, name: text });
const snapshot = object({
  sessionId: text,
  identity: literal("guest", "authenticated"),
  user: (v) => v === null || user(v),
  privacy: object({ history: bool, analytics: bool, personalization: bool }),
  retentionDays: integer,
  admin: bool,
});
const event = object({
  id: text,
  command: text,
  category: text,
  purpose: text,
  createdAt: text,
  status: literal("submitted"),
  exitCode: literal(null),
  durationMs: literal(null),
});
const usage = object({
  sessions: integer,
  commands: integer,
  terminalTimeMs: integer,
  recommendationImpressions: integer,
  recommendationClicks: integer,
  inputTokens: integer,
  outputTokens: integer,
  totalTokens: integer,
  aiRequests: integer,
  tokenLimit: integer,
  remainingTokens: integer,
  topCommands: array(object({ command: text, count: integer })),
});
const recommendation = object({
  id: text,
  command: text,
  category: text,
  purpose: text,
  reason: text,
  risk: literal("read", "write"),
  sourceUrl: text,
});
const checks: Record<keyof Rpc, Check> = {
  "session.current": snapshot,
  "privacy.update": snapshot,
  "guest.delete": snapshot,
  "account.register": snapshot,
  "account.login": snapshot,
  "account.logout": snapshot,
  "command.record": object({
    recorded: bool,
    event: (v) => v === null || event(v),
  }),
  "history.list": object({ items: array(event, 100) }),
  "history.delete": object({ deleted: literal(true) }),
  "analytics.delete": object({ deleted: literal(true) }),
  "data.export": object({
    session: snapshot,
    history: array(event, 50),
    usage,
    nextCursor: (value) => value === null || isUuidV4(value),
  }),
  "recommendations.get": object({
    items: array(recommendation, 6),
    mode: literal("catalog", "local-model"),
  }),
  "recommendation.click": object({ recorded: bool }),
  "terminal.record": object({ recorded: bool }),
  "usage.get": usage,
  "billing.get": object({
    plan: literal("Personal prototype"),
    commercialEnabled: literal(false),
    tokenLimit: integer,
    tokensUsed: integer,
  }),
  "admin.overview": object({
    users: integer,
    sessions: integer,
    commands: integer,
    inputTokens: integer,
    outputTokens: integer,
    totalTokens: integer,
    activeConnections: integer,
  }),
};
export function validResult(method: keyof Rpc, value: unknown): boolean {
  return checks[method](value);
}
