import rpcFixtures from "./fixtures/rpc-fixtures-1.0.json";
import { validRequest } from "./request";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vectorFile from "./fixtures/auth-vectors-1.0.json";
import {
  IntelligenceClient,
  intelligenceEndpoint,
  intelligenceProof,
  validCommand,
} from "./client";
import {
  computeAuthenticationProof,
  importCredentialKey,
} from "../protocol/auth";
import { MemoryCredentialStore } from "../protocol/credentialStore";
import { validResult } from "./validate";

// Canonical public fixture copied unchanged from Session01 contract 79cc961.
const vector = vectorFile.positive;
const provider = webcrypto as unknown as Crypto;
const policy = {
  endpoint: "wss://sai.tailf8dcea.ts.net/terminal",
  expectedWebOrigin: "https://terminus-web.vercel.app",
};
class SocketDouble {
  protocol = "terminus.intelligence.v1";
  onmessage: ((e: { data: unknown }) => Promise<void>) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => this.onclose?.());
  async receive(data: unknown) {
    await this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
}
let clients: IntelligenceClient[] = [];
afterEach(() => {
  clients.forEach((c) => c.dispose());
  clients = [];
  vi.useRealTimers();
});
async function setup() {
  const store = new MemoryCredentialStore(provider);
  await store.saveCredential(
    "33333333-3333-4333-8333-333333333333",
    vector.credentialSecret,
    new Date(Date.now() + 60000).toISOString(),
  );
  const sockets: SocketDouble[] = [];
  const factory = vi.fn(() => {
    const s = new SocketDouble();
    sockets.push(s);
    return s as unknown as WebSocket;
  });
  const client = new IntelligenceClient(
    policy,
    policy.expectedWebOrigin,
    store,
    factory,
  );
  clients.push(client);
  client.connect();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  return { client, socket: sockets[0], sockets, factory };
}
async function ready(socket: SocketDouble) {
  await socket.receive({
    type: "challenge",
    connectionId: vector.connectionId,
    challengeId: vector.challengeId,
    challenge: vector.challenge,
    expiresAt: new Date(Date.now() + 9000).toISOString(),
  });
  await socket.receive({ type: "ready" });
}
describe("private intelligence contract boundary (socket doubles)", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", provider);
  });
  it("matches canonical HMAC fixture and separates terminal domain", async () => {
    const key = await importCredentialKey(vector.credentialSecret, provider);
    expect(key.extractable).toBe(false);
    expect(
      await intelligenceProof(
        key,
        vector.connectionId,
        vector.challengeId,
        vector.challenge,
        provider,
      ),
    ).toBe(vector.proof);
    expect(
      await computeAuthenticationProof(
        key,
        vector.connectionId,
        vector.challengeId,
        vector.challenge,
        provider,
      ),
    ).not.toBe(vector.proof);
  });
  it("derives only validated same-host intelligence endpoint", () => {
    expect(intelligenceEndpoint(policy, policy.expectedWebOrigin)).toBe(
      "wss://sai.tailf8dcea.ts.net/intelligence",
    );
    for (const endpoint of [
      "ws://sai.tailf8dcea.ts.net/terminal",
      policy.endpoint + "?secret=x",
      policy.endpoint + "#fragment",
      "wss://other.test/intelligence",
    ]) {
      expect(() =>
        intelligenceEndpoint({ ...policy, endpoint }, policy.expectedWebOrigin),
      ).toThrow();
    }
    expect(() =>
      intelligenceEndpoint(policy, "https://untrusted.test"),
    ).toThrow();
  });
  it("authenticates, correlates responses, and preserves safe errors", async () => {
    const { client, socket, factory } = await setup();
    await ready(socket);
    expect(factory).toHaveBeenCalledWith(
      "wss://sai.tailf8dcea.ts.net/intelligence",
      "terminus.intelligence.v1",
    );
    expect(client.getState()).toBe("ready");
    const request = client.request("history.list", {});
    const sent = JSON.parse(socket.send.mock.calls.at(-1)![0]);
    await socket.receive({
      type: "result",
      id: sent.id,
      ok: true,
      data: { items: [] },
    });
    await expect(request).resolves.toEqual({ items: [] });
    const denied = client.request("admin.overview", {});
    const rejection = expect(denied).rejects.toThrow("FORBIDDEN");
    await socket.receive({
      type: "result",
      id: JSON.parse(socket.send.mock.calls.at(-1)![0]).id,
      ok: false,
      error: "FORBIDDEN",
    });
    await rejection;
  });
  it.each(["expired", "unknown", "binary", "oversized", "replayed"])(
    "closes %s handshake",
    async (kind) => {
      const { socket } = await setup();
      const challenge = {
        type: "challenge",
        connectionId: vector.connectionId,
        challengeId: vector.challengeId,
        challenge: vector.challenge,
        expiresAt: new Date(
          Date.now() + (kind === "expired" ? -1 : 9000),
        ).toISOString(),
        ...(kind === "unknown" ? { extra: true } : {}),
      };
      if (kind === "binary")
        await socket.onmessage?.({ data: new ArrayBuffer(5) });
      else if (kind === "oversized") await socket.receive("x".repeat(65537));
      else {
        await socket.receive(challenge);
        if (kind === "replayed") await socket.receive(challenge);
      }
      expect(socket.close).toHaveBeenCalled();
    },
  );
  it("times out requests and cancels retries on disposal", async () => {
    const { client, socket, factory } = await setup();
    await ready(socket);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const request = client.request("usage.get", {});
    const rejection = expect(request).rejects.toThrow("UNAVAILABLE");
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;
    socket.close();
    client.dispose();
    await vi.advanceTimersByTimeAsync(100000);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it("limits reconnection to three retries and rejects malformed result payload", async () => {
    const { client, socket, factory, sockets } = await setup();
    await ready(socket);
    const p = client.request("history.list", {});
    const rejected = expect(p).rejects.toThrow("UNAVAILABLE");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await socket.receive({
      type: "result",
      id: JSON.parse(socket.send.mock.calls.at(-1)![0]).id,
      ok: true,
      data: { items: "bad" },
    });
    await rejected;
    for (const delay of [1000, 2000, 4000]) {
      await vi.advanceTimersByTimeAsync(delay);
      await Promise.resolve();
      sockets.at(-1)!.close();
    }
    await vi.advanceTimersByTimeAsync(20000);
    expect(factory).toHaveBeenCalledTimes(4);
  });
  it("requires pairing without creating a socket", async () => {
    const factory = vi.fn();
    const c = new IntelligenceClient(
      policy,
      policy.expectedWebOrigin,
      new MemoryCredentialStore(provider),
      factory,
    );
    clients.push(c);
    c.connect();
    await vi.waitFor(() => expect(c.getState()).toBe("pairing-required"));
    expect(factory).not.toHaveBeenCalled();
  });
  it("rejects a server selecting the wrong subprotocol", async () => {
    const { socket } = await setup();
    socket.protocol = "terminus.v0_2";
    await ready(socket);
    expect(socket.close).toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
  });
  it("manual retry refreshes a healthy transport without opening another socket", async () => {
    const { client, socket, factory } = await setup();
    await ready(socket);
    const listener = vi.fn();
    client.subscribe(listener);
    client.connect();
    expect(listener).toHaveBeenLastCalledWith("ready");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledTimes(1);
  });
  it("bounds active RPCs and never transmits injected ownership", async () => {
    const { client, socket } = await setup();
    await ready(socket);
    await expect(
      client.request("history.list", { userId: "other" } as never),
    ).rejects.toThrow("INVALID_REQUEST");
    const pending = Array.from({ length: 5 }, () =>
      client.request("history.list", {}),
    );
    const failures = pending.map((p) =>
      expect(p).rejects.toThrow("UNAVAILABLE"),
    );
    await expect(client.request("history.list", {})).rejects.toThrow(
      "UNAVAILABLE",
    );
    client.dispose();
    await Promise.all(failures);
    expect(socket.send).toHaveBeenCalledTimes(6);
  });
  it("bounds composer by UTF-8 bytes and rejects controls", () => {
    expect(validCommand("Get-Date")).toBe(true);
    for (const s of ["", " \t", "Get-Date\r", "a\u001bb", "ðŸ˜€".repeat(1025)])
      expect(validCommand(s)).toBe(false);
    expect(validCommand("x".repeat(4096))).toBe(true);
  });
  it("validates closed result shapes and no commercial enablement", () => {
    expect(
      validResult("billing.get", {
        plan: "Personal prototype",
        commercialEnabled: true,
        tokenLimit: 100,
        tokensUsed: 0,
      }),
    ).toBe(false);
    expect(validResult("history.list", { items: [], secret: "bad" })).toBe(
      false,
    );
    expect(
      validResult("recommendations.get", { items: [], mode: "hosted-model" }),
    ).toBe(false);
  });
});

it("consumes canonical RPC fixture acceptance and rejection", () => {
  for (const item of rpcFixtures.accepted)
    expect(validRequest(item.frame), item.name).toBe(true);
  for (const item of rpcFixtures.rejected)
    expect(validRequest(item.frame), item.name).toBe(false);
});

it("validates private account password length by UTF-8 bytes", () => {
  const frame = {
    type: "request",
    id: "11111111-1111-4111-8111-111111111111",
    method: "account.login",
    params: { email: "synthetic@example.test", password: "\u00e9".repeat(6) },
  };
  expect(validRequest(frame)).toBe(true);
  expect(
    validRequest({
      ...frame,
      params: { ...frame.params, password: "\u00e9".repeat(5) },
    }),
  ).toBe(false);
  expect(
    validRequest({
      ...frame,
      params: { ...frame.params, password: "\u00e9".repeat(513) },
    }),
  ).toBe(false);
});
