import { isSessionId } from "./codec";

export type SessionFragment =
  | { kind: "root" }
  | { kind: "session"; sessionId: string }
  | { kind: "invalid" };

export function parseSessionFragment(hash: string): SessionFragment {
  if (hash === "" || hash === "#") return { kind: "root" };
  const match = /^#\/s\/([^/]+)$/u.exec(hash);
  if (match === null || !isSessionId(match[1])) return { kind: "invalid" };
  return { kind: "session", sessionId: match[1] };
}

export function sessionFragment(sessionId: string): string {
  if (!isSessionId(sessionId)) throw new TypeError("Invalid session ID.");
  return `#/s/${sessionId}`;
}
