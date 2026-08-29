import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  TerminalAdapter,
  TerminalConnectionState,
} from "../terminal/adapter";
import { MockTerminalAdapter } from "../terminal/mockTerminalAdapter";
import { TerminalShell } from "./TerminalShell";

const xtermMock = vi.hoisted(() => ({
  data: { listener: undefined as ((value: string) => void) | undefined },
  dispose: vi.fn(),
  focus: vi.fn(),
  inputDispose: vi.fn(),
  onData: vi.fn((listener: (value: string) => void) => {
    xtermMock.data.listener = listener;
    return { dispose: xtermMock.inputDispose };
  }),
  open: vi.fn(),
  options: { fontSize: 14, theme: {} },
  refresh: vi.fn(),
  resize: vi.fn(),
  rows: 8,
  write: vi.fn(),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    dispose = xtermMock.dispose;
    focus = xtermMock.focus;
    onData = xtermMock.onData;
    open = xtermMock.open;
    options = xtermMock.options;
    refresh = xtermMock.refresh;
    resize = xtermMock.resize;
    rows = xtermMock.rows;
    write = xtermMock.write;
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  xtermMock.data.listener = undefined;
});

describe("TerminalShell", () => {
  it("labels the test double and keeps input disabled until connected", async () => {
    const user = userEvent.setup();
    render(<TerminalShell />);

    expect(
      screen.getByText("SIMULATED UI — NO TERMINAL CONNECTION"),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Simulation input" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Start simulation" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/connected/i);
    expect(
      screen.getByRole("textbox", { name: "Simulation input" }),
    ).toHaveFocus();
    expect(screen.queryByText("mTLS · PRIVATE")).not.toBeInTheDocument();
  });

  it("supports keyboard submit, paste, mobile keys, and disconnect", async () => {
    const user = userEvent.setup();
    const adapter = new MockTerminalAdapter();
    const inputSpy = vi.spyOn(adapter, "sendInput");
    render(<TerminalShell adapterFactory={() => adapter} />);

    await user.click(screen.getByRole("button", { name: "Start simulation" }));
    const input = screen.getByRole("textbox", { name: "Simulation input" });
    await user.type(input, "synthetic-input{Enter}");
    expect(inputSpy).toHaveBeenCalledWith("synthetic-input");

    fireEvent.paste(input, {
      clipboardData: { getData: () => "synthetic-paste" },
    });
    expect(inputSpy).toHaveBeenCalledWith("synthetic-paste");

    await user.click(screen.getByRole("button", { name: "Send Escape" }));
    expect(inputSpy).toHaveBeenCalledWith("\u001b");

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(screen.getByRole("status")).toHaveTextContent(/disconnected/i);
    expect(input).toBeDisabled();
  });

  it("switches the complete interface between English and Swedish", async () => {
    const user = userEvent.setup();
    render(<TerminalShell />);

    await user.click(screen.getByRole("button", { name: "Switch to Swedish" }));

    expect(
      screen.getByRole("heading", { name: "Terminalarbetsyta" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Starta simulering" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Byt till engelska" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "sv");

    await user.click(screen.getByRole("button", { name: "Byt till engelska" }));
    expect(
      screen.getByRole("heading", { name: "Terminal workspace" }),
    ).toBeVisible();
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });

  it("reports a failed connection and exposes a retry control", async () => {
    const user = userEvent.setup();
    const adapter = new FailingAdapter();
    render(<TerminalShell adapterFactory={() => adapter} />);

    await user.click(screen.getByRole("button", { name: "Start simulation" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/error/i);
    expect(
      screen.getByRole("button", { name: "Retry simulation" }),
    ).toBeEnabled();
  });

  it("gives bilingual system guidance when PowerShell cannot open", async () => {
    const user = userEvent.setup();
    const adapter = new FailingAdapter(
      "SESSION_OPEN_FAILED",
      "protocol-client",
    );
    render(<TerminalShell adapterFactory={() => adapter} />);

    await user.click(screen.getByRole("button", { name: "Connect privately" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "PowerShell could not open. Check the Windows agent and available system resources, then retry.",
    );
    expect(
      screen.getByRole("button", { name: "Retry private connection" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Switch to Swedish" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "PowerShell kunde inte öppnas. Kontrollera Windows-agenten och tillgängliga systemresurser och försök sedan igen.",
    );
    expect(
      screen.getByRole("button", { name: "Försök ansluta privat igen" }),
    ).toBeEnabled();
  });

  it("updates orientation and keeps viewport dimensions above safe minimums", async () => {
    render(<TerminalShell />);
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 844,
    });

    fireEvent(window, new Event("orientationchange"));

    await waitFor(() => {
      expect(
        screen.getByLabelText("Terminal viewport information"),
      ).toHaveTextContent("portrait");
      expect(screen.getByRole("log")).toHaveAttribute("data-columns", "20");
      expect(screen.getByRole("log")).toHaveAttribute("data-rows", "8");
    });
  });

  it("exposes an accessible transient pairing flow for the protocol client", async () => {
    const user = userEvent.setup();
    const adapter = new ProtocolUiAdapter();
    const pairSpy = vi.spyOn(adapter, "pair");
    render(<TerminalShell adapterFactory={() => adapter} />);

    await user.click(screen.getByRole("button", { name: "Connect privately" }));
    const pairingInput = screen.getByLabelText("One-time pairing code");
    expect(pairingInput).toHaveAttribute("autocomplete", "off");
    await user.type(pairingInput, "AAECAwQFBgcICQoLDA0ODw");
    await user.click(screen.getByRole("button", { name: "Pair locally" }));

    expect(pairSpy).toHaveBeenCalledWith("AAECAwQFBgcICQoLDA0ODw");
    expect(
      screen.queryByLabelText("One-time pairing code"),
    ).not.toBeInTheDocument();
  });

  it("detaches on background and reconnects only after a valid detached state", async () => {
    const adapter = new ProtocolUiAdapter("connected");
    render(<TerminalShell adapterFactory={() => adapter} />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(adapter.detachCalls).toBe(1));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(adapter.connectCalls).toBe(1));
  });

  it("waits for an in-flight iPhone detach before foreground reconnect", async () => {
    const adapter = new ProtocolUiAdapter("connected", true);
    render(<TerminalShell adapterFactory={() => adapter} />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    fireEvent(document, new Event("visibilitychange"));
    await waitFor(() => expect(adapter.detachCalls).toBe(1));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    fireEvent(document, new Event("visibilitychange"));
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(adapter.connectCalls).toBe(0);

    adapter.completeDetach();
    await waitFor(() => expect(adapter.connectCalls).toBe(1));
  });

  it("does not detach during page teardown so refresh releases server resources", async () => {
    const adapter = new ProtocolUiAdapter("connected");
    render(<TerminalShell adapterFactory={() => adapter} />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new PageTransitionEvent("pagehide"));
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(adapter.detachCalls).toBe(0);
  });

  it("detaches a persisted Safari page before it is frozen", async () => {
    const adapter = new ProtocolUiAdapter("connected");
    render(<TerminalShell adapterFactory={() => adapter} />);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    fireEvent(document, new Event("visibilitychange"));
    fireEvent(window, new PageTransitionEvent("pagehide", { persisted: true }));

    await waitFor(() => expect(adapter.detachCalls).toBe(1));
  });

  it("streams protocol output through the ANSI terminal renderer", () => {
    const adapter = new ProtocolUiAdapter("connected");
    const inputSpy = vi.spyOn(adapter, "sendInput");
    render(<TerminalShell adapterFactory={() => adapter} />);

    adapter.emitOutput("\u001b[32msynthetic-output\u001b[0m");
    xtermMock.data.listener?.("\u0003");

    expect(xtermMock.write).toHaveBeenCalledWith(
      "\u001b[32msynthetic-output\u001b[0m",
    );
    expect(inputSpy).toHaveBeenCalledWith("\u0003");
    expect(screen.getByText("mTLS · PRIVATE")).toBeVisible();
    expect(screen.queryByText("synthetic-output")).not.toBeInTheDocument();
  });
});

class FailingAdapter implements TerminalAdapter {
  readonly kind: TerminalAdapter["kind"];
  readonly label = "FAILING TEST DOUBLE — NO TERMINAL CONNECTION";
  private state: TerminalConnectionState = "disconnected";
  private readonly listeners = new Set<
    (state: TerminalConnectionState) => void
  >();

  constructor(
    private readonly errorCode?: string,
    kind: TerminalAdapter["kind"] = "test-double",
  ) {
    this.kind = kind;
  }

  async connect(): Promise<void> {
    this.state = "error";
    this.listeners.forEach((listener) => listener(this.state));
    throw new Error("Synthetic connection failure");
  }

  async disconnect(): Promise<void> {
    this.state = "disconnected";
  }

  getState(): TerminalConnectionState {
    return this.state;
  }

  getErrorCode(): string | undefined {
    return this.errorCode;
  }

  resize(): void {}

  sendInput(): void {}

  subscribe(listener: (state: TerminalConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeOutput(): () => void {
    return () => undefined;
  }
}

class ProtocolUiAdapter implements TerminalAdapter {
  readonly kind = "protocol-client" as const;
  readonly label = "PRIVATE WSS · PROTOCOL 0.1 · agent.private.invalid";
  readonly supportsPairing = true;
  private readonly listeners = new Set<
    (state: TerminalConnectionState) => void
  >();
  private readonly outputListeners = new Set<(output: string) => void>();
  private state: TerminalConnectionState;
  connectCalls = 0;
  detachCalls = 0;

  constructor(
    initialState: TerminalConnectionState = "disconnected",
    private readonly deferDetach = false,
  ) {
    this.state = initialState;
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.setState(this.state === "detached" ? "connected" : "pairing");
  }

  async detach(): Promise<void> {
    this.detachCalls += 1;
    this.setState("detaching");
    if (!this.deferDetach) this.setState("detached");
  }

  completeDetach(): void {
    this.setState("detached");
  }

  async disconnect(): Promise<void> {
    this.setState("disconnected");
  }

  getState(): TerminalConnectionState {
    return this.state;
  }

  async pair(pairingCode: string): Promise<void> {
    void pairingCode;
    this.setState("authenticating");
  }

  resize(): void {}

  sendInput(): void {}

  subscribe(listener: (state: TerminalConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeOutput(listener: (output: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  emitOutput(output: string): void {
    this.outputListeners.forEach((listener) => listener(output));
  }

  private setState(state: TerminalConnectionState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
