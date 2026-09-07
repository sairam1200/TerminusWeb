import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useIntelligence } from "./useIntelligence";
import type { PrivateWssPolicy } from "../protocol/endpointPolicy";
const fake = vi.hoisted(() => ({
  requests: [] as ReturnType<typeof vi.fn>[],
  disposed: vi.fn(),
  nextRequest: undefined as ReturnType<typeof vi.fn> | undefined,
}));
vi.mock("./client", () => ({
  IntelligenceClient: class {
    listener: (state: string) => void = () => {};
    request =
      fake.nextRequest ?? vi.fn().mockResolvedValue({ sessionId: "current" });
    constructor() {
      fake.requests.push(this.request);
    }
    subscribe(l: (s: string) => void) {
      this.listener = l;
      return () => {};
    }
    connect() {
      this.listener("ready");
    }
    getState() {
      return "ready";
    }
    dispose() {
      fake.disposed();
    }
  },
}));
const policy: PrivateWssPolicy = {
  endpoint: "wss://sai.tailf8dcea.ts.net/terminal",
  expectedWebOrigin: "https://terminus-web.vercel.app",
};
beforeEach(() => {
  fake.requests = [];
  fake.disposed.mockReset();
  fake.nextRequest = undefined;
});
afterEach(cleanup);
it("clears ready state and prior session immediately when policy is removed", async () => {
  const hook = renderHook(({ policy }) => useIntelligence(policy), {
    initialProps: { policy: policy as PrivateWssPolicy | undefined },
  });
  await waitFor(() =>
    expect(hook.result.current.session?.sessionId).toBe("current"),
  );
  hook.rerender({ policy: undefined });
  expect(hook.result.current.state).toBe("disconnected");
  expect(hook.result.current.session).toBeUndefined();
  expect(fake.disposed).toHaveBeenCalled();
});
it("ignores late snapshot from disposed old policy", async () => {
  let resolveOld: (v: unknown) => void = () => {};
  fake.nextRequest = vi.fn(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const hook = renderHook(({ policy }) => useIntelligence(policy), {
    initialProps: { policy },
  });
  fake.nextRequest = undefined;
  hook.rerender({
    policy: { ...policy, endpoint: "wss://second.test/terminal" },
  });
  await waitFor(() =>
    expect(hook.result.current.session?.sessionId).toBe("current"),
  );
  await act(async () => resolveOld({ sessionId: "old-owner" }));
  expect(hook.result.current.session?.sessionId).toBe("current");
});
