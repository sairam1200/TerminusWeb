export interface Privacy {
  history: boolean;
  analytics: boolean;
  personalization: boolean;
}
export interface SessionSnapshot {
  sessionId: string;
  identity: "guest" | "authenticated";
  user: { id: string; email: string; name: string } | null;
  privacy: Privacy;
  retentionDays: number;
  admin: boolean;
}
export interface CommandEvent {
  id: string;
  command: string;
  category: string;
  purpose: string;
  createdAt: string;
  status: "submitted";
  exitCode: null;
  durationMs: null;
}
export interface Recommendation {
  id: string;
  command: string;
  category: string;
  purpose: string;
  reason: string;
  risk: "read" | "write";
  sourceUrl: string;
}
export interface Usage {
  sessions: number;
  commands: number;
  terminalTimeMs: number;
  recommendationImpressions: number;
  recommendationClicks: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  aiRequests: number;
  tokenLimit: number;
  remainingTokens: number;
  topCommands: { command: string; count: number }[];
}
export interface Rpc {
  "session.current": [Record<string, never>, SessionSnapshot];
  "privacy.update": [Privacy, SessionSnapshot];
  "command.record": [
    { eventId: string; command: string },
    { recorded: boolean; event: CommandEvent | null },
  ];
  "history.list": [
    { query?: string; category?: string; limit?: number },
    { items: CommandEvent[] },
  ];
  "history.delete": [Record<string, never>, { deleted: true }];
  "analytics.delete": [Record<string, never>, { deleted: true }];
  "guest.delete": [Record<string, never>, SessionSnapshot];
  "data.export": [
    { cursor?: string },
    {
      session: SessionSnapshot;
      history: CommandEvent[];
      usage: Usage;
      nextCursor: string | null;
    },
  ];
  "recommendations.get": [
    { query?: string },
    { items: Recommendation[]; mode: "catalog" | "local-model" },
  ];
  "recommendation.click": [{ id: string }, { recorded: boolean }];
  "terminal.record": [
    { eventId: string; state: "connected" | "disconnected" | "reconnecting" },
    { recorded: boolean },
  ];
  "usage.get": [Record<string, never>, Usage];
  "account.register": [
    { email: string; password: string; name: string },
    SessionSnapshot,
  ];
  "account.login": [{ email: string; password: string }, SessionSnapshot];
  "account.logout": [Record<string, never>, SessionSnapshot];
  "billing.get": [
    Record<string, never>,
    {
      plan: "Personal prototype";
      commercialEnabled: false;
      tokenLimit: number;
      tokensUsed: number;
    },
  ];
  "admin.overview": [
    Record<string, never>,
    {
      users: number;
      sessions: number;
      commands: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      activeConnections: number;
    },
  ];
}
export type IntelligenceState =
  "disconnected" | "connecting" | "ready" | "unavailable" | "pairing-required";
export interface IntelligenceApi {
  request<M extends keyof Rpc>(
    method: M,
    params: Rpc[M][0],
  ): Promise<Rpc[M][1]>;
}
