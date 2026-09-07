import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { TerminalShell } from "./TerminalShell";
import type {
  TerminalAdapter,
  TerminalConnectionState,
} from "../terminal/adapter";
// Guidance tests use an adapter double and never construct the canvas renderer.
vi.mock("@xterm/xterm", () => ({ Terminal: class {} }));
beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});
function failingAdapter(transport: boolean): TerminalAdapter {
  let state: TerminalConnectionState = "disconnected";
  const listeners = new Set<(state: TerminalConnectionState) => void>();
  return {
    kind: "test-double",
    label: "GUIDANCE TEST DOUBLE",
    connect: async () => {
      state = "error";
      listeners.forEach((l) => l(state));
    },
    disconnect: async () => {},
    getState: () => state,
    getErrorCode: () => "SESSION_OPEN_FAILED",
    getFailureCause: () => (transport ? "transport" : undefined),
    resize: vi.fn(),
    sendInput: vi.fn(),
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    subscribeOutput: () => () => {},
  };
}
it("shows truthful transport guidance instead of claiming PowerShell failed", async () => {
  const adapter = failingAdapter(true);
  render(<TerminalShell adapterFactory={() => adapter} />);
  fireEvent.click(screen.getByRole("button", { name: "Start simulation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The secure terminal connection failed or closed unexpectedly.",
  );
  expect(
    screen.queryByText(/PowerShell could not open/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Switch to Swedish" }));
  expect(screen.getByRole("alert")).toHaveTextContent("terminalanslutningen");
});
it("preserves genuine server session-open guidance", async () => {
  render(<TerminalShell adapterFactory={() => failingAdapter(false)} />);
  fireEvent.click(screen.getByRole("button", { name: "Start simulation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "PowerShell could not open.",
  );
});
it("links only validated configured origin without carrying current fragment", () => {
  window.history.replaceState(null, "", "/#/s/k7m4-p2q9-wxyz");
  render(
    <TerminalShell
      protocolProfiles={[
        {
          mode: "private",
          endpoint: "wss://sai.tailf8dcea.ts.net/terminal",
          expectedWebOrigin: "https://sai.tailf8dcea.ts.net",
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("link", { name: "Open private Terminus" }),
  ).toHaveAttribute("href", "https://sai.tailf8dcea.ts.net");
  expect(
    screen.queryByRole("button", { name: "Connect privately" }),
  ).not.toBeInTheDocument();
});
it.each([
  "javascript:alert(1)",
  "https://secret@preview.example.invalid",
  "https://preview.example.invalid/?token=example",
])("does not link invalid configured origin %s", (origin) => {
  render(
    <TerminalShell
      protocolConfig={{
        endpoint: "wss://sai.tailf8dcea.ts.net/terminal",
        expectedWebOrigin: origin,
      }}
    />,
  );
  expect(screen.getByRole("alert")).toBeInTheDocument();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});
