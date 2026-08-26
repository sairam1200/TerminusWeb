import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type {
  TerminalAdapter,
  TerminalConnectionState,
} from "../terminal/adapter";
import { MockTerminalAdapter } from "../terminal/mockTerminalAdapter";
import { TerminalShell } from "./TerminalShell";

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

    expect(await screen.findByRole("status")).toHaveTextContent("connected");
    expect(
      screen.getByRole("textbox", { name: "Simulation input" }),
    ).toHaveFocus();
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
    expect(screen.getByRole("status")).toHaveTextContent("disconnected");
    expect(input).toBeDisabled();
  });

  it("reports a failed connection and exposes a retry control", async () => {
    const user = userEvent.setup();
    const adapter = new FailingAdapter();
    render(<TerminalShell adapterFactory={() => adapter} />);

    await user.click(screen.getByRole("button", { name: "Start simulation" }));

    expect(await screen.findByRole("status")).toHaveTextContent("error");
    expect(
      screen.getByRole("button", { name: "Retry simulation" }),
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
});

class FailingAdapter implements TerminalAdapter {
  readonly kind = "test-double" as const;
  readonly label = "FAILING TEST DOUBLE — NO TERMINAL CONNECTION";
  private state: TerminalConnectionState = "disconnected";
  private readonly listeners = new Set<
    (state: TerminalConnectionState) => void
  >();

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
  private state: TerminalConnectionState;
  connectCalls = 0;
  detachCalls = 0;

  constructor(initialState: TerminalConnectionState = "disconnected") {
    this.state = initialState;
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    this.setState(this.state === "detached" ? "connected" : "pairing");
  }

  async detach(): Promise<void> {
    this.detachCalls += 1;
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

  subscribeOutput(): () => void {
    return () => undefined;
  }

  private setState(state: TerminalConnectionState) {
    this.state = state;
    this.listeners.forEach((listener) => listener(state));
  }
}
