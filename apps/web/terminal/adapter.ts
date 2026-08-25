export type TerminalConnectionState =
  "disconnected" | "connecting" | "connected" | "error";

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
  connect(options?: TerminalConnectOptions): Promise<void>;
  disconnect(): Promise<void>;
  getState(): TerminalConnectionState;
  resize(viewport: TerminalViewport): void;
  sendInput(data: string): void;
  subscribe(listener: (state: TerminalConnectionState) => void): () => void;
  subscribeOutput(listener: (marker: string) => void): () => void;
}
