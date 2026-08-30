import { webcrypto } from "node:crypto";
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
    expect(events).toEqual(["session-opened", "session-opened"]);
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
