import { createHmac, webcrypto } from "node:crypto";
import { waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import {
  IndexedDbCredentialStore,
  MemoryCredentialStore,
  type CredentialStore,
} from "../protocol/credentialStore";
import type { ProtocolFrame } from "../protocol/types";
import { ProtocolViolation } from "../protocol/types";
import { ProtocolContractMachine } from "../protocol/contractMachine";
import {
  ProtocolTerminalAdapter,
  type WebSocketPort,
} from "./protocolTerminalAdapter";

const cryptoProvider = webcrypto as unknown as Crypto;
const now = Date.parse("2026-08-26T12:00:00.000Z");
const endpoint = "wss://agent.private.invalid/terminal";
const webOrigin = "https://preview.example.invalid";
const credentialId = "30000000-0000-4000-8000-000000000001";
const credentialSecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
const challengeId = "20000000-0000-4000-8000-000000000001";
const challenge = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8";
const sessionId = "k7m4-p2q9-wxyz";

describe("ProtocolTerminalAdapter", () => {
  it("times out a never-opened transport and reopens its retained locator on retry", async () => {
    const { adapter, sockets } = await connectedFixture();
    adapter.release();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const pending = adapter.connect();
      const rejected = expect(pending).rejects.toThrow(
        "Terminal connection released.",
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(sockets).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(10000);
      await rejected;
      expect(adapter.getState()).toBe("detached");
      expect(adapter.getSessionId()).toBe(sessionId);
    } finally {
      vi.useRealTimers();
    }
    const retry = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(3));
    sockets[2]!.open();
    await retry;
    await authenticate(sockets[2]!, "reopen_session");
    expect(sockets[2]!.sentFrame(2).payload).toMatchObject({ sessionId });
    adapter.release();
  });

  it("clears the pre-open timeout on release and on open without limiting pairing approval", async () => {
    const { adapter, sockets } = await connectedFixture();
    adapter.release();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const old = adapter.connect();
      const rejected = expect(old).rejects.toThrow(
        "Terminal connection released.",
      );
      await vi.advanceTimersByTimeAsync(0);
      adapter.release();
      await rejected;
      const replacement = adapter.connect();
      await vi.advanceTimersByTimeAsync(0);
      sockets[2]!.open();
      await replacement;
      await vi.advanceTimersByTimeAsync(10000);
      expect(sockets[2]!.closeCode).toBeUndefined();
      adapter.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the locator and recent entry when End Terminal cannot send", async () => {
    localStorage.clear();
    const { adapter, socket } = await connectedFixture();
    socket.send = () => {
      throw new Error("synthetic transport failure");
    };
    await expect(adapter.disconnect()).rejects.toThrow(
      "Terminal transport send failed.",
    );
    expect(adapter.getState()).toBe("detached");
    expect(adapter.getSessionId()).toBe(sessionId);
    expect(await adapter.getRecentSessions()).toEqual([
      { sessionId, lastUsedAt: now },
    ]);
  });
  it("preserves a closing socket's session when input races the close callback", async () => {
    const { adapter, socket } = await connectedFixture();
    socket.readyState = 2;
    adapter.sendInput("synthetic input");
    await waitFor(() => expect(adapter.getState()).toBe("detached"));
    expect(adapter.getSessionId()).toBe(sessionId);
    expect(
      socket.sent.map((frame) => (JSON.parse(frame) as ProtocolFrame).type),
    ).not.toContain("error");
  });

  it("records only successful session metadata and forgets an acknowledged end", async () => {
    localStorage.clear();
    const { adapter, socket, connectionId } = await connectedFixture();
    expect(await adapter.getRecentSessions()).toEqual([
      { sessionId, lastUsedAt: now },
    ]);
    await adapter.disconnect();
    expect(await adapter.getRecentSessions()).toHaveLength(1);
    await socket.receive(
      agentFrame(connectionId, 4, "session_closed", {
        sessionId,
        reason: "user_request",
      }),
    );
    await waitFor(async () =>
      expect(await adapter.getRecentSessions()).toEqual([]),
    );
  });

  it("reopens the same session after a transport error without sending a fatal error", async () => {
    const { adapter, sockets, socket } = await connectedFixture();
    socket.error();
    await waitFor(() => expect(adapter.getState()).toBe("detached"));
    expect(
      socket.sent.map((frame) => (JSON.parse(frame) as ProtocolFrame).type),
    ).not.toContain("error");
    const ready = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const replacement = sockets[1]!;
    replacement.open();
    await ready;
    await authenticate(replacement, "reopen_session");
    expect(replacement.sentFrame(2).payload).toMatchObject({ sessionId });
    await adapter.disconnect();
  });

  it("orders a pending old pairing save before a replacement adapter loads credentials", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const first = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const old = sockets[0]!;
    old.open();
    await first;
    const id = old.sentFrame(0).connectionId;
    await old.receive(
      agentFrame(id, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("pairing"));
    await adapter.pair("AAAAAAAAAAAAAAAAAAAAAA");
    const save = store.saveCredential.bind(store);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const saveSpy = vi
      .spyOn(store, "saveCredential")
      .mockImplementationOnce(async (...args) => {
        order.push("save-start");
        await gate;
        const result = await save(...args);
        order.push("save-end");
        return result;
      });
    old.onmessage?.({
      data: JSON.stringify(
        agentFrame(id, 1, "pairing_result", {
          credentialId,
          credentialSecret,
          credentialExpiresAt: "2026-09-25T12:00:00.000Z",
        }),
      ),
    });
    await waitFor(() => expect(order).toEqual(["save-start"]));
    await adapter.disconnect();
    const load = store.loadCredential.bind(store);
    const loadSpy = vi
      .spyOn(store, "loadCredential")
      .mockImplementation(async () => {
        order.push("load");
        return load();
      });
    const nextSockets: MockWebSocket[] = [];
    const next = createAdapter(store, nextSockets);
    const connecting = next.connect();
    try {
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(nextSockets).toHaveLength(0);
      release();
      await waitFor(() => expect(nextSockets).toHaveLength(1));
      nextSockets[0]!.open();
      await connecting;
      expect(order).toEqual(["save-start", "save-end", "load"]);
      expect(nextSockets[0]!.sentFrame(0).payload.credentialId).toBe(
        credentialId,
      );
      expect(adapter.getState()).toBe("disconnected");
    } finally {
      release();
      saveSpy.mockRestore();
      loadSpy.mockRestore();
      await next.disconnect();
    }
  });
  it("ignores old error and close while replacement credential load is pending", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const first = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const old = sockets[0]!;
    old.open();
    await first;
    old.error();
    await waitFor(() => expect(adapter.getState()).toBe("error"));
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = store.loadCredential.bind(store);
    const spy = vi
      .spyOn(store, "loadCredential")
      .mockImplementationOnce(async () => {
        await gate;
        return load();
      });
    const next = adapter.connect();
    old.onerror?.();
    old.onclose?.({ code: 1006 });
    expect(adapter.getState()).toBe("connecting");
    expect(adapter.getErrorCode()).toBeUndefined();
    release();
    await waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.open();
    await next;
    spy.mockRestore();
    await adapter.disconnect();
  });
  it("does not let rejected queued sends or old New Session continuations fail a replacement", async () => {
    const { adapter, socket, sockets } = await connectedFixture();
    socket.bufferedAmount = 65536;
    adapter.resize({ columns: 81, rows: 25 });
    adapter.sendInput("synthetic");
    const replacement = adapter.newSession();
    const canceled = expect(replacement).rejects.toThrow();
    await adapter.disconnect();
    const next = adapter.connect();
    await canceled;
    await waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.open();
    await next;
    expect(adapter.getState()).toBe("connecting");
    expect(adapter.getErrorCode()).toBeUndefined();
    await adapter.disconnect();
  });
  it("preserves incoming progress when an overlapping outgoing send rolls back", async () => {
    const { adapter, socket, connectionId } = await connectedFixture();
    const output = vi.fn();
    adapter.subscribeOutput(output);
    const machine = (adapter as unknown as { machine: ProtocolContractMachine })
      .machine;
    const original = machine.apply.bind(machine);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    vi.spyOn(machine, "apply").mockImplementation(
      async (direction, frame, context) => {
        if (
          direction === "client_to_agent" &&
          (frame as ProtocolFrame).type === "close_session"
        ) {
          entered = true;
          await gate;
        }
        return original(direction, frame, context);
      },
    );
    const send = socket.send.bind(socket);
    vi.spyOn(socket, "send")
      .mockImplementationOnce(() => {
        throw new Error("Synthetic send refusal");
      })
      .mockImplementation(send);
    const replacement = adapter.newSession();
    const rejected = expect(replacement).rejects.toThrow();
    await waitFor(() => expect(entered).toBe(true));
    socket.onmessage?.({
      data: JSON.stringify(
        agentFrame(connectionId, 4, "terminal_output", {
          sessionId,
          offset: 0,
          data: "YQ",
        }),
      ),
    });
    release();
    await rejected;
    await waitFor(() => expect(output).toHaveBeenCalledTimes(1));
    await socket.receive(
      agentFrame(connectionId, 5, "terminal_output", {
        sessionId,
        offset: 1,
        data: "Yg",
      }),
    );
    await waitFor(() => expect(output).toHaveBeenCalledTimes(2));
    expect(adapter.getState()).toBe("connected");
    adapter.resize({ columns: 81, rows: 25 });
    await waitFor(() => expect(socket.sentFrame(3).sequence).toBe(3));
    await adapter.disconnect();
  });
  it("answers an incoming ping without deadlocking the shared machine lock", async () => {
    const { adapter, socket, connectionId } = await connectedFixture();
    adapter.resize({ columns: 81, rows: 25 });
    await socket.receive(
      agentFrame(connectionId, 4, "heartbeat", {
        kind: "ping",
        nonce: "AAECAwQFBgcICQoLDA0ODw",
      }),
    );
    await waitFor(() => expect(socket.sent).toHaveLength(5));
    expect(socket.sentFrame(4)).toMatchObject({
      type: "heartbeat",
      sequence: 4,
      payload: { kind: "pong" },
    });
    await adapter.disconnect();
  });
  it("bounds queued outbound bytes and releases reservations on failure", async () => {
    const { adapter, socket } = await connectedFixture();
    const internals = adapter as unknown as {
      machine: ProtocolContractMachine;
      work: { outboundBytes: number };
    };
    const original = internals.machine.apply.bind(internals.machine);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    vi.spyOn(internals.machine, "apply").mockImplementation(
      async (direction, frame, context) => {
        if (direction === "client_to_agent" && !entered) {
          entered = true;
          await gate;
        }
        return original(direction, frame, context);
      },
    );
    adapter.resize({ columns: 81, rows: 25 });
    await waitFor(() => expect(entered).toBe(true));
    adapter.sendInput("x".repeat(16384));
    adapter.sendInput("x".repeat(16384));
    adapter.sendInput("x".repeat(16384));
    expect(
      internals.work.outboundBytes + socket.bufferedAmount,
    ).toBeLessThanOrEqual(65536);
    await waitFor(() =>
      expect(adapter.getErrorCode()).toBe("BACKPRESSURE_LIMIT"),
    );
    release();
    await waitFor(() => expect(internals.work.outboundBytes).toBe(0));
    expect(
      socket.sent
        .slice(3)
        .filter(
          (raw) => (JSON.parse(raw) as ProtocolFrame).type === "terminal_input",
        ),
    ).toHaveLength(0);
    await adapter.disconnect();
  });
  it("ignores delayed old authentication and old socket callbacks after reconnect", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const first = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const old = sockets[0]!;
    old.open();
    await first;
    const connectionId = old.sentFrame(0).connectionId;
    await old.receive(
      agentFrame(connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    const sign = cryptoProvider.subtle.sign.bind(cryptoProvider.subtle);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = false;
    const spy = vi
      .spyOn(cryptoProvider.subtle, "sign")
      .mockImplementation(async (...args) => {
        entered = true;
        await gate;
        return sign(...args);
      });
    try {
      old.onmessage?.({
        data: JSON.stringify(
          agentFrame(connectionId, 1, "auth_challenge", {
            challengeId,
            challenge,
            expiresAt: "2026-08-26T12:00:10.000Z",
          }),
        ),
      });
      await waitFor(() => expect(entered).toBe(true));
      await adapter.disconnect();
      const next = adapter.connect();
      await waitFor(() => expect(sockets).toHaveLength(2));
      const current = sockets[1]!;
      current.open();
      await next;
      old.onopen?.();
      old.onmessage?.({ data: "invalid old frame" });
      release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(current.sent).toHaveLength(1);
      expect(current.sentFrame(0).type).toBe("hello");
      expect(adapter.getState()).toBe("connecting");
      expect(adapter.getErrorCode()).toBeUndefined();
    } finally {
      release();
      spy.mockRestore();
      await adapter.disconnect();
    }
  });
  it("opens a separate session only after explicit rejected-reopen recovery", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const first = adapter.connect({ sessionId });
    await waitFor(() => expect(sockets).toHaveLength(1));
    sockets[0]!.open();
    await first;
    const id = await authenticate(sockets[0]!, "reopen_session");
    await sockets[0]!.receive(
      agentFrame(id, 3, "error", {
        code: "SESSION_REOPEN_REJECTED",
        fatal: true,
      }),
    );
    await waitFor(() =>
      expect(adapter.getErrorCode()).toBe("SESSION_REOPEN_REJECTED"),
    );
    expect(sockets).toHaveLength(1);
    const recovery = adapter.newSession();
    await waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]!.open();
    await waitFor(() => expect(sockets[1]!.sent).toHaveLength(1));
    const fresh = await authenticate(sockets[1]!, "open_session");
    expect(
      sockets[0]!.sent.map((raw) => (JSON.parse(raw) as ProtocolFrame).type),
    ).not.toContain("close_session");
    await sockets[1]!.receive(
      agentFrame(fresh, 3, "session_opened", { sessionId: "2345-6789-abcd" }),
    );
    await recovery;
    expect(adapter.getSessionId()).toBe("2345-6789-abcd");
    await adapter.disconnect();
  });
  it("assigns distinct ordered sequences to same-turn resize and input", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const connection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await connection;
    const connectionId = await authenticate(socket, "open_session");
    await socket.receive(
      agentFrame(connectionId, 3, "session_opened", { sessionId }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("connected"));
    const dimensions = { columns: 81, rows: 25 };
    adapter.resize(dimensions);
    adapter.sendInput("synthetic");
    adapter.resize({ columns: 82, rows: 26 });
    dimensions.columns = 99;
    await waitFor(() => expect(socket.sent).toHaveLength(6));
    expect(
      socket.sent
        .slice(3)
        .map((frame) => (JSON.parse(frame) as ProtocolFrame).sequence),
    ).toEqual([3, 4, 5]);
    expect(socket.sentFrame(3).payload.dimensions).toEqual({
      columns: 81,
      rows: 25,
    });
    await adapter.disconnect();
  });
  it("authenticates, opens, exchanges IO/resize/heartbeat, detaches, reopens, replays, and closes", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const output = vi.fn();
    adapter.subscribeOutput(output);

    const firstConnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const firstSocket = sockets[0] as MockWebSocket;
    expect(firstSocket.url).toBe(endpoint);
    expect(firstSocket.requestedSubprotocol).toBe("terminus.v0_2");
    firstSocket.open();
    await firstConnection;

    const hello = firstSocket.sentFrame(0);
    expect(hello).toMatchObject({
      version: "0.2",
      type: "hello",
      sequence: 0,
      payload: { credentialId, supportedVersions: ["0.2"] },
    });
    const connectionId = hello.connectionId;
    await firstSocket.receive(
      agentFrame(connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await firstSocket.receive(
      agentFrame(connectionId, 1, "auth_challenge", {
        challengeId,
        challenge,
        expiresAt: "2026-08-26T12:00:10.000Z",
      }),
    );
    await waitFor(() =>
      expect(firstSocket.sentFrame(1).type).toBe("auth_response"),
    );
    expect(firstSocket.sentFrame(1).payload).toMatchObject({
      challengeId,
      credentialId,
    });

    await firstSocket.receive(
      agentFrame(connectionId, 2, "auth_result", {
        authenticated: true,
        authorizationExpiresAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    await waitFor(() =>
      expect(firstSocket.sentFrame(2).type).toBe("open_session"),
    );
    await firstSocket.receive(
      agentFrame(connectionId, 3, "session_opened", { sessionId }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("connected"));

    adapter.sendInput("synthetic-input");
    adapter.resize({ columns: 1000, rows: 1 });
    await waitFor(() => expect(firstSocket.sentFrame(4).type).toBe("resize"));
    expect(firstSocket.sentFrame(3).type).toBe("terminal_input");
    await firstSocket.receive(
      agentFrame(connectionId, 4, "terminal_output", {
        sessionId,
        offset: 0,
        data: "AP8",
      }),
    );
    expect(output).toHaveBeenCalledTimes(1);
    await firstSocket.receive(
      agentFrame(connectionId, 5, "heartbeat", {
        kind: "ping",
        nonce: "AAECAwQFBgcICQoLDA0ODw",
      }),
    );
    await waitFor(() =>
      expect(firstSocket.sentFrame(5).type).toBe("heartbeat"),
    );

    await adapter.detach();
    expect(firstSocket.sentFrame(6).type).toBe("detach");
    await firstSocket.receive(
      agentFrame(connectionId, 6, "session_detached", {
        sessionId,
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("detached"));

    const reconnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const secondSocket = sockets[1] as MockWebSocket;
    secondSocket.open();
    await reconnection;
    const reconnectHello = secondSocket.sentFrame(0);
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 1, "auth_challenge", {
        challengeId,
        challenge,
        expiresAt: "2026-08-26T12:00:10.000Z",
      }),
    );
    await waitFor(() =>
      expect(secondSocket.sentFrame(1).type).toBe("auth_response"),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 2, "auth_result", {
        authenticated: true,
        authorizationExpiresAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    await waitFor(() =>
      expect(secondSocket.sentFrame(2).type).toBe("reopen_session"),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 3, "session_reopened", {
        sessionId,
      }),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 4, "history_begin", {
        sessionId,
        startOffset: 0,
        endOffset: 2,
        truncated: false,
      }),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 5, "history_chunk", {
        sessionId,
        offset: 0,
        data: "AP8",
      }),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 6, "history_end", {
        sessionId,
        endOffset: 2,
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("connected"));

    await adapter.disconnect();
    expect(secondSocket.sentFrame(3).type).toBe("close_session");
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 7, "session_closed", {
        sessionId,
        reason: "user_request",
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("disconnected"));
  });

  it("opens a session when the browser wall clock is behind", async () => {
    const clientNow = now - 5 * 60 * 1000;
    const store = new MemoryCredentialStore(cryptoProvider, () => clientNow);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T11:55:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      store,
      sockets,
      () => 0,
      () => clientNow,
    );

    const connection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await connection;
    const hello = socket.sentFrame(0);
    await socket.receive(
      agentFrame(hello.connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await socket.receive(
      agentFrame(hello.connectionId, 1, "auth_challenge", {
        challengeId,
        challenge,
        expiresAt: "2026-08-26T12:00:10.000Z",
      }),
    );

    await waitFor(() => expect(socket.sentFrame(1).type).toBe("auth_response"));
    await socket.receive(
      agentFrame(hello.connectionId, 2, "auth_result", {
        authenticated: true,
        authorizationExpiresAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    await waitFor(() => expect(socket.sentFrame(2).type).toBe("open_session"));
    expect(adapter.getErrorCode()).toBeUndefined();
  });

  it("waits for old-session closure before opening a fresh New Session", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const events: string[] = [];
    adapter.subscribeSession((event) => events.push(event.type));

    const initialConnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const initialSocket = sockets[0] as MockWebSocket;
    initialSocket.open();
    await initialConnection;
    const firstConnectionId = await authenticate(initialSocket, "open_session");
    await initialSocket.receive(
      agentFrame(firstConnectionId, 3, "session_opened", { sessionId }),
    );

    const replacement = adapter.newSession();
    await waitFor(() =>
      expect(initialSocket.sentFrame(3).type).toBe("close_session"),
    );
    expect(initialSocket.sentFrame(3)).toMatchObject({
      type: "close_session",
      payload: { sessionId, reason: "new_session" },
    });
    expect(sockets).toHaveLength(1);
    await initialSocket.receive(
      agentFrame(firstConnectionId, 4, "session_closed", {
        sessionId,
        reason: "new_session",
      }),
    );

    await waitFor(() => expect(sockets).toHaveLength(2));
    const replacementSocket = sockets[1] as MockWebSocket;
    replacementSocket.open();
    await waitFor(() => expect(replacementSocket.sent).toHaveLength(1));
    const replacementConnectionId = await authenticate(
      replacementSocket,
      "open_session",
    );
    const replacementSessionId = "rstv-wxyz-2345";
    await replacementSocket.receive(
      agentFrame(replacementConnectionId, 3, "session_opened", {
        sessionId: replacementSessionId,
      }),
    );

    await expect(replacement).resolves.toBeUndefined();
    expect(adapter.getSessionId()).toBe(replacementSessionId);
    expect(events).toEqual([
      "session-opened",
      "session-ended",
      "session-opened",
    ]);
  });

  it("keeps the attached session retryable when New Session cannot send close", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);

    const initialConnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const initialSocket = sockets[0] as MockWebSocket;
    initialSocket.open();
    await initialConnection;
    const connectionId = await authenticate(initialSocket, "open_session");
    await initialSocket.receive(
      agentFrame(connectionId, 3, "session_opened", { sessionId }),
    );

    initialSocket.bufferedAmount = 65_536;
    await expect(adapter.newSession()).rejects.toMatchObject({
      code: "BACKPRESSURE_LIMIT",
    });
    expect(adapter.getState()).toBe("connected");
    expect(adapter.getSessionId()).toBe(sessionId);
    expect(initialSocket.sent).toHaveLength(3);

    initialSocket.bufferedAmount = 0;
    const replacement = adapter.newSession();
    await waitFor(() =>
      expect(initialSocket.sentFrame(3)).toMatchObject({
        type: "close_session",
        sequence: 3,
        payload: { sessionId, reason: "new_session" },
      }),
    );
    await initialSocket.receive(
      agentFrame(connectionId, 4, "session_closed", {
        sessionId,
        reason: "new_session",
      }),
    );
    await waitFor(() => expect(sockets).toHaveLength(2));
    const replacementSocket = sockets[1] as MockWebSocket;
    replacementSocket.open();
    await waitFor(() => expect(replacementSocket.sent).toHaveLength(1));
    const replacementConnectionId = await authenticate(
      replacementSocket,
      "open_session",
    );
    await replacementSocket.receive(
      agentFrame(replacementConnectionId, 3, "session_opened", {
        sessionId: "rstv-wxyz-2345",
      }),
    );

    await expect(replacement).resolves.toBeUndefined();
  });

  it("rejects New Session when the old transport closes before its acknowledgement", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);

    const initialConnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await initialConnection;
    const connectionId = await authenticate(socket, "open_session");
    await socket.receive(
      agentFrame(connectionId, 3, "session_opened", { sessionId }),
    );

    const replacement = adapter.newSession();
    await waitFor(() => expect(socket.sent).toHaveLength(4));
    socket.close(1011);

    await expect(replacement).rejects.toMatchObject({
      code: "SESSION_OPEN_FAILED",
    });
    expect(adapter.getSessionId()).toBe(sessionId);
    expect(adapter.getState()).toBe("error");
  });

  it("rejects New Session when its fresh connection cannot open", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);

    const initialConnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const initialSocket = sockets[0] as MockWebSocket;
    initialSocket.open();
    await initialConnection;
    const connectionId = await authenticate(initialSocket, "open_session");
    await initialSocket.receive(
      agentFrame(connectionId, 3, "session_opened", { sessionId }),
    );

    const replacement = adapter.newSession();
    await waitFor(() => expect(initialSocket.sent).toHaveLength(4));
    await initialSocket.receive(
      agentFrame(connectionId, 4, "session_closed", {
        sessionId,
        reason: "new_session",
      }),
    );
    await waitFor(() => expect(sockets).toHaveLength(2));
    (sockets[1] as MockWebSocket).error();

    await expect(replacement).rejects.toMatchObject({
      code: "SESSION_OPEN_FAILED",
    });
    expect(adapter.getSessionId()).toBeUndefined();
    expect(adapter.getState()).toBe("error");

    const retry = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(3));
    const retrySocket = sockets[2] as MockWebSocket;
    retrySocket.open();
    await retry;
    const retryConnectionId = await authenticate(retrySocket, "open_session");
    await retrySocket.receive(
      agentFrame(retryConnectionId, 3, "session_opened", {
        sessionId: "2345-6789-abcd",
      }),
    );
    expect(adapter.getSessionId()).toBe("2345-6789-abcd");
    expect(adapter.getState()).toBe("connected");
  });

  it("reopens a detached session with the remembered ID", async () => {
    const clientNow = now + 5 * 60 * 1000;
    const monotonic = { value: 0 };
    const store = new MemoryCredentialStore(cryptoProvider, () => clientNow);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T11:55:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      store,
      sockets,
      () => monotonic.value,
      () => clientNow,
    );

    await driveToDetached(adapter, sockets);
    expect(adapter.getState()).toBe("detached");

    const reconnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const socket = sockets[1] as MockWebSocket;
    socket.open();
    await reconnection;
    await authenticate(socket, "reopen_session");
  });

  it("uses a transient pairing code and stores the returned credential as a key", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const connection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await connection;
    const hello = socket.sentFrame(0);
    expect(hello.payload).not.toHaveProperty("credentialId");

    await socket.receive(
      agentFrame(hello.connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("pairing"));
    await adapter.pair("AAECAwQFBgcICQoLDA0ODw");
    expect(socket.sentFrame(1)).toMatchObject({
      type: "pairing_request",
      payload: { pairingCode: "AAECAwQFBgcICQoLDA0ODw" },
    });

    await socket.receive(
      agentFrame(hello.connectionId, 1, "pairing_result", {
        credentialId,
        credentialSecret,
        credentialExpiresAt: "2026-09-25T12:00:00.000Z",
      }),
    );
    await waitFor(async () =>
      expect((await store.loadCredential())?.key.extractable).toBe(false),
    );
  });

  it("pairs once and silently reuses the persisted credential after a page reload", async () => {
    const indexedDb = new IDBFactory();
    const initialStore = new IndexedDbCredentialStore(
      indexedDb,
      cryptoProvider,
      () => now,
    );
    const initialSockets: MockWebSocket[] = [];
    const initialAdapter = createAdapter(initialStore, initialSockets);
    const pairingStates: string[] = [];
    initialAdapter.subscribe((state) => pairingStates.push(state));

    const initialConnection = initialAdapter.connect();
    await waitFor(() => expect(initialSockets).toHaveLength(1));
    const initialSocket = initialSockets[0] as MockWebSocket;
    initialSocket.open();
    await initialConnection;
    const initialHello = initialSocket.sentFrame(0);
    expect(initialHello.payload).not.toHaveProperty("credentialId");
    await initialSocket.receive(
      agentFrame(initialHello.connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await waitFor(() => expect(initialAdapter.getState()).toBe("pairing"));
    await initialAdapter.pair("AAECAwQFBgcICQoLDA0ODw");
    await initialSocket.receive(
      agentFrame(initialHello.connectionId, 1, "pairing_result", {
        credentialId,
        credentialSecret,
        credentialExpiresAt: "2026-09-25T12:00:00.000Z",
      }),
    );
    await waitFor(async () =>
      expect((await initialStore.loadCredential())?.credentialId).toBe(
        credentialId,
      ),
    );
    expect(pairingStates).toContain("pairing");

    // A new store and adapter model a later page load in the same browser
    // profile. IndexedDB retains the non-extractable signing key, while the
    // one-time pairing code and raw credential secret are not reused.
    const reloadedStore = new IndexedDbCredentialStore(
      indexedDb,
      cryptoProvider,
      () => now,
    );
    const reloadedSockets: MockWebSocket[] = [];
    const reloadedAdapter = createAdapter(reloadedStore, reloadedSockets);
    const reloadedStates: string[] = [];
    reloadedAdapter.subscribe((state) => reloadedStates.push(state));

    const reloadedConnection = reloadedAdapter.connect({ sessionId });
    await waitFor(() => expect(reloadedSockets).toHaveLength(1));
    const reloadedSocket = reloadedSockets[0] as MockWebSocket;
    reloadedSocket.open();
    await reloadedConnection;
    const reloadedHello = reloadedSocket.sentFrame(0);
    expect(reloadedHello.payload).toMatchObject({ credentialId });
    await reloadedSocket.receive(
      agentFrame(reloadedHello.connectionId, 0, "hello_ack", {
        selectedVersion: "0.2",
        agentId: "50000000-0000-4000-8000-000000000001",
      }),
    );
    await reloadedSocket.receive(
      agentFrame(reloadedHello.connectionId, 1, "auth_challenge", {
        challengeId,
        challenge,
        expiresAt: "2026-08-26T12:00:10.000Z",
      }),
    );
    await waitFor(() =>
      expect(reloadedSocket.sentFrame(1).type).toBe("auth_response"),
    );
    await reloadedSocket.receive(
      agentFrame(reloadedHello.connectionId, 2, "auth_result", {
        authenticated: true,
        authorizationExpiresAt: "2026-08-27T00:00:00.000Z",
      }),
    );
    await waitFor(() =>
      expect(reloadedSocket.sentFrame(2)).toMatchObject({
        type: "reopen_session",
        payload: { sessionId },
      }),
    );
    expect(reloadedStates).not.toContain("pairing");
    expect(
      reloadedSocket.sent.map((frame) => JSON.parse(frame) as ProtocolFrame),
    ).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "pairing_request" }),
      ]),
    );
  });

  it("keeps two browser credentials independent while opening sessions on the same host", async () => {
    // Separate fake IndexedDB factories model independent browser profiles.
    // WebSocket responses are contract-boundary doubles, not agent acceptance.
    const browsers = [
      {
        id: credentialId,
        secret: credentialSecret,
        code: "AAECAwQFBgcICQoLDA0ODw",
        session: sessionId,
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        secret: challenge,
        code: "EBESExQVFhcYGRobHB0eHw",
        session: "a7m4-p2q9-wxyz",
      },
    ].map((browser) => ({
      ...browser,
      database: new IDBFactory(),
      clientId: "",
    }));

    for (const browser of browsers) {
      const store = new IndexedDbCredentialStore(
        browser.database,
        cryptoProvider,
        () => now,
      );
      const sockets: MockWebSocket[] = [];
      const adapter = createAdapter(store, sockets);
      const connected = adapter.connect();
      await waitFor(() => expect(sockets).toHaveLength(1));
      const socket = sockets[0]!;
      socket.open();
      await connected;
      const hello = socket.sentFrame(0);
      browser.clientId = String(hello.payload.clientInstanceId);
      expect(hello.payload).not.toHaveProperty("credentialId");
      await socket.receive(
        agentFrame(hello.connectionId, 0, "hello_ack", {
          selectedVersion: "0.2",
          agentId: "50000000-0000-4000-8000-000000000001",
        }),
      );
      await waitFor(() => expect(adapter.getState()).toBe("pairing"));
      await adapter.pair(browser.code);
      expect(socket.sentFrame(1).payload).toEqual({
        pairingCode: browser.code,
      });
      await socket.receive(
        agentFrame(hello.connectionId, 1, "pairing_result", {
          credentialId: browser.id,
          credentialSecret: browser.secret,
          credentialExpiresAt: "2026-09-25T12:00:00.000Z",
        }),
      );
      await waitFor(async () =>
        expect((await store.loadCredential())?.credentialId).toBe(browser.id),
      );
      await adapter.disconnect();
    }
    expect(browsers[0]!.clientId).not.toBe(browsers[1]!.clientId);

    const active: {
      adapter: ProtocolTerminalAdapter;
      socket: MockWebSocket;
      connectionId: string;
      session: string;
    }[] = [];
    for (const browser of browsers) {
      // Reload A only after B has paired: B must not overwrite A's key.
      const store = new IndexedDbCredentialStore(
        browser.database,
        cryptoProvider,
        () => now,
      );
      expect((await store.loadCredential())?.key.extractable).toBe(false);
      const sockets: MockWebSocket[] = [];
      const adapter = createAdapter(store, sockets);
      const connected = adapter.connect();
      await waitFor(() => expect(sockets).toHaveLength(1));
      const socket = sockets[0]!;
      socket.open();
      await connected;
      expect(socket.url).toBe(endpoint);
      expect(socket.sentFrame(0).payload).toMatchObject({
        credentialId: browser.id,
        clientInstanceId: browser.clientId,
      });
      const connectionId = await authenticate(socket, "open_session");
      const expectedProof = createHmac(
        "sha256",
        Buffer.from(browser.secret, "base64url"),
      )
        .update(
          Buffer.concat([
            Buffer.from(`Terminus/0.2/auth\0${connectionId}\0${challengeId}\0`),
            Buffer.from(challenge, "base64url"),
          ]),
        )
        .digest("base64url");
      expect(socket.sentFrame(1).payload).toMatchObject({
        credentialId: browser.id,
        proof: expectedProof,
      });
      expect(
        socket.sent.map((frame) => (JSON.parse(frame) as ProtocolFrame).type),
      ).not.toContain("pairing_request");
      await socket.receive(
        agentFrame(connectionId, 3, "session_opened", {
          sessionId: browser.session,
        }),
      );
      await waitFor(() => expect(adapter.getState()).toBe("connected"));
      active.push({ adapter, socket, connectionId, session: browser.session });
    }
    expect(active.map(({ adapter }) => adapter.getState())).toEqual([
      "connected",
      "connected",
    ]);
    for (const { adapter, socket, connectionId, session } of active) {
      await adapter.disconnect();
      expect(socket.sentFrame(3).payload).toMatchObject({ sessionId: session });
      await socket.receive(
        agentFrame(connectionId, 4, "session_closed", {
          sessionId: session,
          reason: "user_request",
        }),
      );
    }
  });

  it("rejects an unconfigured destination before opening a socket", async () => {
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      new MemoryCredentialStore(cryptoProvider),
      sockets,
    );
    await expect(
      adapter.connect({ destination: "wss://other.private.invalid/terminal" }),
    ).rejects.toBeInstanceOf(ProtocolViolation);
    expect(sockets).toHaveLength(0);
  });

  it("fails closed on a history offset gap", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets);
    const reconnection = adapter.connect({ sessionId });
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await reconnection;
    const connectionId = await authenticate(socket, "reopen_session");
    await socket.receive(
      agentFrame(connectionId, 3, "session_reopened", { sessionId }),
    );
    await socket.receive(
      agentFrame(connectionId, 4, "history_begin", {
        sessionId,
        startOffset: 0,
        endOffset: 4,
        truncated: false,
      }),
    );
    await socket.receive(
      agentFrame(connectionId, 5, "history_chunk", {
        sessionId,
        offset: 2,
        data: "AP8",
      }),
    );
    await waitFor(() =>
      expect(adapter.getErrorCode()).toBe("OUTPUT_OFFSET_INVALID"),
    );
    await waitFor(() => expect(socket.closeCode).toBe(4008));
  });

  it("closes with BACKPRESSURE_LIMIT before the outbound buffer can grow unbounded", async () => {
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      new MemoryCredentialStore(cryptoProvider),
      sockets,
    );
    const connection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.bufferedAmount = 65_536;
    socket.open();

    await expect(connection).rejects.toMatchObject({
      code: "BACKPRESSURE_LIMIT",
    });
    await waitFor(() =>
      expect(adapter.getErrorCode()).toBe("BACKPRESSURE_LIMIT"),
    );
    await waitFor(() => expect(socket.closeCode).toBe(4008));
    expect(socket.sent).toHaveLength(0);
  });

  it("uses a browser-valid application close code for agent errors", async () => {
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      new MemoryCredentialStore(cryptoProvider),
      sockets,
    );
    const connection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await connection;
    const hello = socket.sentFrame(0);

    await socket.receive(
      agentFrame(hello.connectionId, 0, "error", {
        code: "AUTHENTICATION_FAILED",
        fatal: true,
      }),
    );

    await waitFor(() =>
      expect(adapter.getErrorCode()).toBe("AUTHENTICATION_FAILED"),
    );
    expect(socket.closeCode).toBe(4008);
  });

  it("fails closed on malformed, binary, replayed, and wrong-subprotocol input", async () => {
    const cases: Array<{
      input: string | ArrayBuffer;
      expectedCode: string;
      expectedClose: number;
    }> = [
      {
        input: '{"version":"0.2"',
        expectedCode: "INVALID_JSON",
        expectedClose: 4007,
      },
      {
        input: new ArrayBuffer(1),
        expectedCode: "SCHEMA_INVALID",
        expectedClose: 4002,
      },
    ];
    for (const testCase of cases) {
      const sockets: MockWebSocket[] = [];
      const adapter = createAdapter(
        new MemoryCredentialStore(cryptoProvider),
        sockets,
      );
      const connected = adapter.connect();
      await waitFor(() => expect(sockets).toHaveLength(1));
      const socket = sockets[0] as MockWebSocket;
      socket.open();
      await connected;
      await socket.receiveRaw(testCase.input);
      await waitFor(() =>
        expect(adapter.getErrorCode()).toBe(testCase.expectedCode),
      );
      await waitFor(() =>
        expect(socket.closeCode).toBe(testCase.expectedClose),
      );
    }

    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(
      new MemoryCredentialStore(cryptoProvider),
      sockets,
    );
    const connected = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0] as MockWebSocket;
    socket.open();
    await connected;
    const hello = socket.sentFrame(0);
    const ack = agentFrame(hello.connectionId, 0, "hello_ack", {
      selectedVersion: "0.2",
      agentId: "50000000-0000-4000-8000-000000000001",
    });
    await socket.receive(ack);
    await socket.receive(ack);
    await waitFor(() => expect(adapter.getErrorCode()).toBe("SEQUENCE_REPLAY"));
    await waitFor(() => expect(socket.closeCode).toBe(4008));

    const wrongProtocolSockets: MockWebSocket[] = [];
    const wrongProtocolAdapter = createAdapter(
      new MemoryCredentialStore(cryptoProvider),
      wrongProtocolSockets,
    );
    const rejected = wrongProtocolAdapter.connect();
    await waitFor(() => expect(wrongProtocolSockets).toHaveLength(1));
    (wrongProtocolSockets[0] as MockWebSocket).open("other.v1");
    await expect(rejected).rejects.toMatchObject({
      code: "UNSUPPORTED_VERSION",
    });
  });
});

async function connectedFixture() {
  const store = new MemoryCredentialStore(cryptoProvider, () => now);
  await store.saveCredential(
    credentialId,
    credentialSecret,
    "2026-09-25T12:00:00.000Z",
  );
  const sockets: MockWebSocket[] = [];
  const adapter = createAdapter(store, sockets);
  const ready = adapter.connect();
  await waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0]!;
  socket.open();
  await ready;
  const connectionId = await authenticate(socket, "open_session");
  await socket.receive(
    agentFrame(connectionId, 3, "session_opened", { sessionId }),
  );
  await waitFor(() => expect(adapter.getState()).toBe("connected"));
  return { adapter, sockets, socket, connectionId };
}

function createAdapter(
  store: CredentialStore,
  sockets: MockWebSocket[],
  monotonicNow?: () => number,
  wallNow: () => number = () => now,
) {
  return new ProtocolTerminalAdapter({
    endpoint,
    expectedWebOrigin: webOrigin,
    credentialStore: store,
    cryptoProvider,
    getCurrentOrigin: () => webOrigin,
    monotonicNow,
    now: wallNow,
    webSocketFactory: (url, subprotocol) => {
      const socket = new MockWebSocket(url, subprotocol);
      sockets.push(socket);
      return socket;
    },
  });
}

async function authenticate(
  socket: MockWebSocket,
  expectedSessionAction: "open_session" | "reopen_session",
): Promise<string> {
  const hello = socket.sentFrame(0);
  await socket.receive(
    agentFrame(hello.connectionId, 0, "hello_ack", {
      selectedVersion: "0.2",
      agentId: "50000000-0000-4000-8000-000000000001",
    }),
  );
  await socket.receive(
    agentFrame(hello.connectionId, 1, "auth_challenge", {
      challengeId,
      challenge,
      expiresAt: "2026-08-26T12:00:10.000Z",
    }),
  );
  await waitFor(() => expect(socket.sentFrame(1).type).toBe("auth_response"));
  await socket.receive(
    agentFrame(hello.connectionId, 2, "auth_result", {
      authenticated: true,
      authorizationExpiresAt: "2026-08-27T00:00:00.000Z",
    }),
  );
  await waitFor(() =>
    expect(socket.sentFrame(2).type).toBe(expectedSessionAction),
  );
  return hello.connectionId;
}

async function driveToDetached(
  adapter: ProtocolTerminalAdapter,
  sockets: MockWebSocket[],
): Promise<void> {
  const connection = adapter.connect();
  await waitFor(() => expect(sockets).toHaveLength(1));
  const socket = sockets[0] as MockWebSocket;
  socket.open();
  await connection;
  const connectionId = await authenticate(socket, "open_session");
  await socket.receive(
    agentFrame(connectionId, 3, "session_opened", { sessionId }),
  );
  await waitFor(() => expect(adapter.getState()).toBe("connected"));
  await adapter.detach();
  await socket.receive(
    agentFrame(connectionId, 4, "session_detached", {
      sessionId,
    }),
  );
  await waitFor(() => expect(adapter.getState()).toBe("detached"));
}

function agentFrame(
  connectionId: string,
  sequence: number,
  type: ProtocolFrame["type"],
  payload: Record<string, unknown>,
): ProtocolFrame {
  return { version: "0.2", type, connectionId, sequence, payload };
}

class MockWebSocket implements WebSocketPort {
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  protocol = "terminus.v0_2";
  readyState = 0;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string | ArrayBuffer | Blob }) => void) | null =
    null;
  onopen: (() => void) | null = null;
  readonly sent: string[] = [];
  closeCode?: number;

  constructor(
    readonly url: string,
    readonly requestedSubprotocol: string,
  ) {}

  open(protocol = "terminus.v0_2") {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.();
  }

  error() {
    this.onerror?.();
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(code = 1000): void {
    this.closeCode = code;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.({ code }));
  }

  sentFrame(index: number): ProtocolFrame {
    return JSON.parse(this.sent[index] ?? "null") as ProtocolFrame;
  }

  async receive(frame: ProtocolFrame): Promise<void> {
    await this.receiveRaw(JSON.stringify(frame));
  }

  async receiveRaw(data: string | ArrayBuffer): Promise<void> {
    this.onmessage?.({ data });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

it("uses local endpoint validation while retaining protocol 0.2 and browser-safe errors", async () => {
  const sockets: MockWebSocket[] = [];
  const adapter = new ProtocolTerminalAdapter({
    mode: "local",
    endpoint: "wss://127.0.0.1:4176/terminal",
    expectedWebOrigin: "http://127.0.0.1:4176",
    getCurrentOrigin: () => "http://127.0.0.1:4176",
    cryptoProvider,
    credentialStore: new MemoryCredentialStore(cryptoProvider, () => now),
    webSocketFactory: (url, subprotocol) => {
      const socket = new MockWebSocket(url, subprotocol);
      sockets.push(socket);
      return socket;
    },
  });
  expect(adapter.label).toContain("LOCAL WSS \u00b7 PROTOCOL 0.2");
  const connecting = adapter.connect();
  await waitFor(() => expect(sockets).toHaveLength(1));
  expect(sockets[0].requestedSubprotocol).toBe("terminus.v0_2");
  sockets[0].open();
  await connecting;
  await adapter.disconnect();
  expect(adapter.getState()).toBe("disconnected");
  expect(
    () =>
      new ProtocolTerminalAdapter({
        mode: "local",
        endpoint,
        expectedWebOrigin: webOrigin,
        getCurrentOrigin: () => webOrigin,
      }),
  ).toThrow(ProtocolViolation);
});
