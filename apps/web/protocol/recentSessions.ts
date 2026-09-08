import { isSessionId, isUuidV4 } from "./codec";

export interface RecentSession {
  sessionId: string;
  lastUsedAt: number;
}
interface Record extends RecentSession {
  scope: string;
  credentialId: string;
}
const KEY = "terminus-recent-sessions-v1";
const LIMIT = 20;

export class RecentSessions {
  constructor(private readonly storage: () => Storage = () => localStorage) {}
  private read(): Record[] {
    try {
      const value: unknown = JSON.parse(this.storage().getItem(KEY) ?? "[]");
      if (!Array.isArray(value) || value.length > LIMIT) return [];
      return value.filter((entry): entry is Record => {
        if (
          typeof entry !== "object" ||
          entry === null ||
          Object.keys(entry).sort().join() !==
            "credentialId,lastUsedAt,scope,sessionId"
        )
          return false;
        return (
          typeof entry.scope === "string" &&
          entry.scope.length <= 2048 &&
          isUuidV4(entry.credentialId) &&
          isSessionId(entry.sessionId) &&
          Number.isSafeInteger(entry.lastUsedAt) &&
          entry.lastUsedAt >= 0
        );
      });
    } catch {
      return [];
    }
  }
  list(scope: string, credentialId: string): RecentSession[] {
    return this.read()
      .filter(
        (entry) => entry.scope === scope && entry.credentialId === credentialId,
      )
      .map(({ sessionId, lastUsedAt }) => ({ sessionId, lastUsedAt }));
  }
  update(
    scope: string,
    credentialId: string,
    sessionId: string,
    now?: number,
  ): void {
    if (
      !isUuidV4(credentialId) ||
      !isSessionId(sessionId) ||
      scope.length > 2048
    )
      return;
    const records = this.read().filter(
      (entry) =>
        !(
          entry.scope === scope &&
          entry.credentialId === credentialId &&
          entry.sessionId === sessionId
        ),
    );
    if (now !== undefined && Number.isSafeInteger(now) && now >= 0)
      records.unshift({ scope, credentialId, sessionId, lastUsedAt: now });
    try {
      this.storage().setItem(KEY, JSON.stringify(records.slice(0, LIMIT)));
    } catch {
      /* Optional metadata must never prevent terminal access. */
    }
  }
}
