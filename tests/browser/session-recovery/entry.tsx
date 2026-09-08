import React from "react";
import { createRoot } from "react-dom/client";
import { TerminalShell } from "@host-web/components/TerminalShell";
import "@host-web/node_modules/@xterm/xterm/css/xterm.css";
import "@host-web/app/globals.css";

// Actual component/recovery controller, explicitly synthetic terminal adapter.
// This harness opens no socket or host and generates no terminal content.
const original = "k7m4-p2q9-wxyz";
let state = "disconnected";
let sessionId: string | undefined;
let entries = [{ sessionId: original, lastUsedAt: 1 }];
const stateListeners = new Set<any>();
const sessionListeners = new Set<any>();
const observations = {
  connects: 0,
  reopens: 0,
  releases: 0,
  ends: 0,
  selected: "",
};
const set = (value: string) => {
  state = value;
  stateListeners.forEach((f) => f(value));
};
const emit = (event: any) => sessionListeners.forEach((f) => f(event));
const adapter: any = {
  kind: "protocol-client",
  label: "S06 SYNTHETIC RECOVERY UI — NO HOST",
  supportsPairing: true,
  getState: () => state,
  getSessionId: () => sessionId,
  getRecentSessions: async () => entries,
  connect: async (options: any = {}) => {
    observations.connects++;
    if (options.sessionId) observations.reopens++;
    sessionId = options.sessionId ?? "2345-6789-abcd";
    observations.selected = sessionId!;
    set("opening");
    emit({
      type: options.sessionId ? "session-reopened" : "session-opened",
      sessionId,
    });
    if (options.sessionId)
      emit({ type: "history-begin", sessionId, truncated: false });
    set("connected");
  },
  release: () => {
    observations.releases++;
    if (sessionId) set("detached");
  },
  disconnect: async () => {
    observations.ends++;
    entries = entries.filter((entry) => entry.sessionId !== sessionId);
    emit({ type: "session-ended", sessionId });
    sessionId = undefined;
    set("disconnected");
  },
  resize: () => {},
  sendInput: () => {
    throw Error("No terminal input allowed");
  },
  subscribe: (f: any) => {
    stateListeners.add(f);
    return () => stateListeners.delete(f);
  },
  subscribeOutput: () => () => {},
  subscribeSession: (f: any) => {
    sessionListeners.add(f);
    return () => sessionListeners.delete(f);
  },
};
(window as any).s06Recovery = observations;
createRoot(document.getElementById("root")!).render(
  <TerminalShell adapterFactory={() => adapter} />,
);
