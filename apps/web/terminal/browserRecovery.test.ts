import { afterEach, expect, it, vi } from "vitest";
import { browserRecovery } from "./browserRecovery";
import type { TerminalAdapter, TerminalConnectionState } from "./adapter";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

function fixture() {
  let state: TerminalConnectionState = "connected";
  let code: string | undefined;
  const listeners = new Set<(state: TerminalConnectionState) => void>();
  const set = (next: TerminalConnectionState, error?: string) => {
    state = next;
    code = error;
    listeners.forEach((listener) => listener(state));
  };
  const adapter = {
    getState: () => state,
    getErrorCode: () => code,
    getSessionId: () => "k7m4-p2q9-wxyz",
    subscribe: (listener: (state: TerminalConnectionState) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    release: vi.fn(() => set("detached")),
    connect: vi.fn(async () => {
      set("reconnecting");
      set("error", "SESSION_REOPEN_REJECTED");
    }),
  } as unknown as TerminalAdapter;
  const control = browserRecovery(adapter);
  return { adapter, control, set };
}

it("bounds a stale-owner recovery episode to eight same-session attempts over 63.5 seconds", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { adapter, control, set } = fixture();
  set("detached");
  for (const [index, delay] of [
    500, 1000, 2000, 4000, 8000, 16000, 16000, 16000,
  ].entries()) {
    await vi.advanceTimersByTimeAsync(delay);
    expect(adapter.connect).toHaveBeenCalledTimes(index + 1);
    expect(adapter.connect).toHaveBeenLastCalledWith({
      sessionId: "k7m4-p2q9-wxyz",
    });
  }
  window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(120000);
  expect(adapter.connect).toHaveBeenCalledTimes(8);
  control.manual();
  set("detached");
  await vi.advanceTimersByTimeAsync(1000);
  expect(adapter.connect).toHaveBeenCalledTimes(9);
  control.dispose();
});

it("stops retries hidden, offline, explicitly disconnected and disposed, and never retries authentication failure", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { adapter, control, set } = fixture();
  set("detached");
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  window.dispatchEvent(new Event("offline"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  set("error", "AUTHENTICATION_FAILED");
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  control.stop();
  set("detached");
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  control.dispose();
  window.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
});

it("releases on tab closure and resets the retry allowance only after successful connection", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { adapter, control, set } = fixture();
  window.dispatchEvent(new Event("pagehide"));
  expect(adapter.release).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("pageshow"));
  await vi.advanceTimersByTimeAsync(500);
  expect(adapter.connect).toHaveBeenCalledOnce();
  set("connected");
  set("detached");
  await vi.advanceTimersByTimeAsync(500);
  expect(adapter.connect).toHaveBeenCalledTimes(2);
  control.dispose();
});

it("releases a reconnect hidden in flight and refuses a late success after explicit disconnect", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { adapter, control, set } = fixture();
  set("reconnecting");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(adapter.release).toHaveBeenCalledOnce();
  set("connected");
  expect(adapter.release).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  control.stop();
  set("connected");
  await vi.advanceTimersByTimeAsync(60000);
  expect(adapter.connect).not.toHaveBeenCalled();
  control.dispose();
});
