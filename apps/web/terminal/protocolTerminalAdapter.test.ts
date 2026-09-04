import { webcrypto } from "node:crypto";
import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryCredentialStore } from "../protocol/credentialStore";
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
const sessionId = "60000000-0000-4000-8000-000000000001";

describe("ProtocolTerminalAdapter", () => {
  it("labels and validates local and private modes distinctly", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const privateSockets: MockWebSocket[] = [];
    const localSockets: MockWebSocket[] = [];
    const privateAdapter = createAdapter(store, privateSockets);
    const localAdapter = createAdapter(
      store,
      localSockets,
      undefined,
      undefined,
      "local",
      "wss://127.0.0.1:4176/terminal",
      "http://127.0.0.1:4176",
      "http://127.0.0.1:4176",
    );

    expect(privateAdapter.label).toContain("PRIVATE WSS | PROTOCOL 0.1");
    expect(localAdapter.label).toContain("LOCAL WSS | PROTOCOL 0.1");
  });

  it("rejects malformed local destination before opening the transport", async () => {
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    expect(() =>
      createAdapter(
        store,
        sockets,
        undefined,
        undefined,
        "local",
        "wss://agent.public.invalid/terminal",
        "https://127.0.0.1:4176",
        "https://127.0.0.1:4176",
      ),
    ).toThrow();
  });

  it("authenticates, opens, exchanges IO/resize/heartbeat, detaches, resumes, and closes", async () => {
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
    expect(firstSocket.requestedSubprotocol).toBe("terminus.v0_1");
    firstSocket.open();
    await firstConnection;

    const hello = firstSocket.sentFrame(0);
    expect(hello).toMatchObject({
      version: "0.1",
      type: "hello",
      sequence: 0,
      payload: { credentialId, supportedVersions: ["0.1"] },
    });
    const connectionId = hello.connectionId;
    await firstSocket.receive(
      agentFrame(connectionId, 0, "hello_ack", {
        selectedVersion: "0.1",
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
        resumeGrant: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
        expiresAt: "2026-08-26T12:02:00.000Z",
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
        selectedVersion: "0.1",
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
      expect(secondSocket.sentFrame(2).type).toBe("resume_session"),
    );
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 3, "session_resumed", {
        sessionId,
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("connected"));

    await adapter.disconnect();
    expect(secondSocket.sentFrame(3).type).toBe("close_session");
    await secondSocket.receive(
      agentFrame(reconnectHello.connectionId, 4, "session_closed", {
        sessionId,
        reason: "user_request",
      }),
    );
    await waitFor(() => expect(adapter.getState()).toBe("disconnected"));
  });

  it("answers a fresh challenge when the browser wall clock is ahead", async () => {
    const clientNow = now + 5 * 60 * 1000;
    const store = new MemoryCredentialStore(cryptoProvider, () => clientNow);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
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
        selectedVersion: "0.1",
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
    expect(adapter.getErrorCode()).toBeUndefined();
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
        selectedVersion: "0.1",
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

  it.each([
    {
      label: "a mismatched session",
      resumedSessionId: "60000000-0000-4000-8000-000000000002",
      monotonicAtResponse: 0,
    },
    {
      label: "an expired grant",
      resumedSessionId: sessionId,
      monotonicAtResponse: 120_001,
    },
  ])("rejects session_resumed for $label", async (testCase) => {
    const monotonic = { value: 0 };
    const store = new MemoryCredentialStore(cryptoProvider, () => now);
    await store.saveCredential(
      credentialId,
      credentialSecret,
      "2026-09-25T12:00:00.000Z",
    );
    const sockets: MockWebSocket[] = [];
    const adapter = createAdapter(store, sockets, () => monotonic.value);
    await driveToDetached(adapter, sockets);

    const reconnection = adapter.connect();
    await waitFor(() => expect(sockets).toHaveLength(2));
    const socket = sockets[1] as MockWebSocket;
    socket.open();
    await reconnection;
    const connectionId = await authenticate(socket, "resume_session");

    monotonic.value = testCase.monotonicAtResponse;
    await socket.receive(
      agentFrame(connectionId, 3, "session_resumed", {
        sessionId: testCase.resumedSessionId,
      }),
    );
    await waitFor(() => expect(adapter.getErrorCode()).toBe("RESUME_REJECTED"));
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
        input: '{"version":"0.1"',
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
      selectedVersion: "0.1",
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
  store: MemoryCredentialStore,
  sockets: MockWebSocket[],
  monotonicNow?: () => number,
  wallNow: () => number = () => now,
  mode: "private" | "local" = "private",
  destination = endpoint,
  origin = webOrigin,
  expectedOrigin = webOrigin,
) {
  return new ProtocolTerminalAdapter({
    endpoint: destination,
    expectedWebOrigin: expectedOrigin,
    mode,
    credentialStore: store,
    cryptoProvider,
    getCurrentOrigin: () => origin,
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
  expectedSessionAction: "open_session" | "resume_session",
): Promise<string> {
  const hello = socket.sentFrame(0);
  await socket.receive(
    agentFrame(hello.connectionId, 0, "hello_ack", {
      selectedVersion: "0.1",
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
      resumeGrant: "QEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaW1xdXl8",
      expiresAt: "2026-08-26T12:02:00.000Z",
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
  return { version: "0.1", type, connectionId, sequence, payload };
}

class MockWebSocket implements WebSocketPort {
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  protocol = "terminus.v0_1";
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

  open(protocol = "terminus.v0_1") {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.();
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