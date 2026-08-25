import type {
  TerminalAdapter,
  TerminalConnectOptions,
  TerminalConnectionState,
  TerminalViewport,
} from "./adapter";

export class MockDestinationError extends Error {
  constructor() {
    super("The S02-001 test double rejects all network destinations.");
    this.name = "MockDestinationError";
  }
}

/**
 * Labelled UI test double. It never opens a socket, interprets a protocol frame,
 * executes input, or retains submitted input.
 */
export class MockTerminalAdapter implements TerminalAdapter {
  readonly kind = "test-double" as const;
  readonly label = "SIMULATED UI — NO TERMINAL CONNECTION";
  private state: TerminalConnectionState = "disconnected";
  private readonly stateListeners = new Set<
    (state: TerminalConnectionState) => void
  >();
  private readonly outputListeners = new Set<(marker: string) => void>();

  async connect(options: TerminalConnectOptions = {}): Promise<void> {
    this.setState("connecting");

    if (options.destination !== undefined) {
      this.setState("error");
      throw new MockDestinationError();
    }

    await Promise.resolve();
    this.setState("connected");
    this.emit("[SIMULATED SESSION READY]");
  }

  async disconnect(): Promise<void> {
    this.setState("disconnected");
    this.emit("[SIMULATED SESSION CLOSED]");
  }

  getState(): TerminalConnectionState {
    return this.state;
  }

  resize({ columns, rows }: TerminalViewport): void {
    if (
      !Number.isInteger(columns) ||
      !Number.isInteger(rows) ||
      columns < 1 ||
      rows < 1
    ) {
      throw new RangeError(
        "Terminal viewport dimensions must be positive integers.",
      );
    }
  }

  sendInput(data: string): void {
    if (this.state !== "connected") {
      throw new Error("The simulated session is not connected.");
    }

    if (data.length > 0) {
      this.emit("[SIMULATED INPUT ACCEPTED]");
    }
  }

  subscribe(listener: (state: TerminalConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeOutput(listener: (marker: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  private emit(marker: string): void {
    this.outputListeners.forEach((listener) => listener(marker));
  }

  private setState(state: TerminalConnectionState): void {
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }
}
