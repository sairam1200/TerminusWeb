export type TerminalConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "authenticating"
  | "opening"
  | "replaying"
  | "connected"
  | "detaching"
  | "detached"
  | "reconnecting"
  | "closing"
  | "error";

export interface TerminalViewport {
  columns: number;
  rows: number;
}

export interface TerminalConnectOptions {
  /** S02-001 test doubles must reject every destination. */
  destination?: string;
  sessionId?: string;
}

export type TerminalSessionEvent =
  | { type: "session-opened"; sessionId: string }
  | { type: "session-reopened"; sessionId: string }
  | {
      type: "history-begin";
      sessionId: string;
      truncated: boolean;
    };

export interface TerminalAdapter {
  readonly kind: "test-double" | "protocol-client";
  readonly label: string;
  readonly supportsPairing?: boolean;
  connect(options?: TerminalConnectOptions): Promise<void>;
  detach?(): Promise<void>;
  disconnect(): Promise<void>;
  getErrorCode?(): string | undefined;
  getSessionId?(): string | undefined;
  getState(): TerminalConnectionState;
  newSession?(): Promise<void>;
  pair?(pairingCode: string): Promise<void>;
  resize(viewport: TerminalViewport): void;
  sendInput(data: string): void;
  subscribe(listener: (state: TerminalConnectionState) => void): () => void;
  subscribeOutput(listener: (marker: string) => void): () => void;
  subscribeSession?(
    listener: (event: TerminalSessionEvent) => void,
  ): () => void;
}
