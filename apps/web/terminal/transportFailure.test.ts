import { webcrypto } from "node:crypto";
import { waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { MemoryCredentialStore } from "../protocol/credentialStore";
import {
  ProtocolTerminalAdapter,
  type WebSocketPort,
} from "./protocolTerminalAdapter";
const provider = webcrypto as unknown as Crypto;
class Socket implements WebSocketPort {
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  protocol = "terminus.v0_2";
  readyState = 0;
  onclose: WebSocketPort["onclose"] = null;
  onerror: WebSocketPort["onerror"] = null;
  onmessage: WebSocketPort["onmessage"] = null;
  onopen: WebSocketPort["onopen"] = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code: 1006 }));
  });
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
}
function setup(factory?: () => WebSocketPort) {
  const sockets: Socket[] = [];
  const adapter = new ProtocolTerminalAdapter({
    endpoint: "wss://agent.private.invalid/terminal",
    expectedWebOrigin: "https://preview.example.invalid",
    getCurrentOrigin: () => "https://preview.example.invalid",
    cryptoProvider: provider,
    credentialStore: new MemoryCredentialStore(provider),
    webSocketFactory:
      factory ??
      (() => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      }),
  });
  return { adapter, sockets };
}
it.each(["error", "close"])(
  "reports %s before upgrade as local transport cause and settles connect",
  async (reason) => {
    const { adapter, sockets } = setup();
    const connection = adapter.connect();
    const rejected = expect(connection).rejects.toThrow();
    await waitFor(() => expect(sockets.length).toBe(1));
    if (reason === "error") sockets[0].onerror?.();
    else sockets[0].close();
    await rejected;
    expect(adapter.getState()).toBe("error");
    expect(adapter.getFailureCause()).toBe("transport");
    expect(sockets[0].send).not.toHaveBeenCalled();
  },
);
it("marks constructor failure without leaking its exception", async () => {
  const { adapter } = setup(() => {
    throw new Error("synthetic private browser detail");
  });
  await expect(adapter.connect()).rejects.not.toThrow(
    "synthetic private browser detail",
  );
  expect(adapter.getFailureCause()).toBe("transport");
  expect(adapter.getState()).toBe("error");
});
it("clears transport cause on retry and ignores an old socket's late error", async () => {
  const { adapter, sockets } = setup();
  const initial = adapter.connect();
  const rejected = expect(initial).rejects.toThrow();
  await waitFor(() => expect(sockets.length).toBe(1));
  sockets[0].onerror?.();
  await rejected;
  const retry = adapter.connect();
  await waitFor(() => expect(sockets.length).toBe(2));
  sockets[1].open();
  await retry;
  sockets[0].onerror?.();
  expect(adapter.getFailureCause()).toBeUndefined();
  expect(adapter.getState()).not.toBe("error");
  await adapter.disconnect();
});
