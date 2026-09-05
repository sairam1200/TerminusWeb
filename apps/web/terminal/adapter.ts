export type TerminalConnectionState =
  | "disconnected"
  | "connecting"
  | "pairing"
  | "authenticating"
  | "opening"
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
}

export interface TerminalAdapter {
  readonly kind: "test-double" | "protocol-client";
  readonly label: string;
  readonly supportsPairing?: boolean;
  connect(options?: TerminalConnectOptions): Promise<void>;
  detach?(): Promise<void>;
  disconnect(): Promise<void>;
  getErrorCode?(): string | undefined;
  getState(): TerminalConnectionState;
  pair?(pairingCode: string): Promise<void>;
  resize(viewport: TerminalViewport): void;
  sendInput(data: string): void;
  subscribe(listener: (state: TerminalConnectionState) => void): () => void;
  subscribeOutput(listener: (marker: string) => void): () => void;
}
