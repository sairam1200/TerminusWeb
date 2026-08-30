import { computeAuthenticationProof } from "../protocol/auth";
import {
  decodeBase64Url,
  encodeBase64Url,
  isSessionId,
  protocolErrorCode,
} from "../protocol/codec";
import {
  AUTH_CHALLENGE_LIFETIME_MS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_LIVENESS_MS,
  MAX_FRAME_BYTES,
  MAX_OUTBOUND_BUFFERED_BYTES,
  MAX_TERMINAL_INPUT_BYTES,
  PROTOCOL_SUBPROTOCOL,
  PROTOCOL_VERSION,
} from "../protocol/constants";
import { ProtocolContractMachine } from "../protocol/contractMachine";
import {
  IndexedDbCredentialStore,
  type CredentialStore,
  type StoredCredential,
} from "../protocol/credentialStore";
import {
  validatePrivateWssPolicy,
  type PrivateWssPolicy,
} from "../protocol/endpointPolicy";
import type { ProtocolErrorCode, ProtocolFrame } from "../protocol/types";
import { ProtocolViolation } from "../protocol/types";
import type {
  TerminalAdapter,
  TerminalConnectOptions,
  TerminalConnectionState,
  TerminalSessionEvent,
  TerminalViewport,
} from "./adapter";

interface SocketMessageEvent {
  data: string | ArrayBuffer | Blob;
}

interface SocketCloseEvent {
  code: number;
}

export interface WebSocketPort {
  binaryType: BinaryType;
  readonly bufferedAmount: number;
  readonly protocol: string;
  readonly readyState: number;
  onclose: ((event: SocketCloseEvent) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: SocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export interface ProtocolTerminalAdapterConfig extends PrivateWssPolicy {
  credentialStore?: CredentialStore;
  cryptoProvider?: Crypto;
  getCurrentOrigin?: () => string;
  monotonicNow?: () => number;
  now?: () => number;
  webSocketFactory?: (url: string, subprotocol: string) => WebSocketPort;
}

const SOCKET_OPEN = 1;
const APPLICATION_CLOSE_CODE_OFFSET = 3000;
const AUTHORIZATION_LIFETIME_MS = 12 * 60 * 60 * 1000;
const textDecoder = new TextDecoder();

interface NewSessionOperation {
  phase: "closing" | "opening";
  resolve: () => void;
  reject: (error: ProtocolViolation) => void;
}

function browserCloseCode(protocolCloseCode: number): number {
  if (protocolCloseCode === 1000) return protocolCloseCode;
  // The browser API reserves 1001-2999 for protocol/extension use and throws
  // when script passes them to close(). Mirror our protocol code in the
  // private 4000 range; the stable reason still carries the application error.
  if (protocolCloseCode >= 1000 && protocolCloseCode <= 1999) {
    return protocolCloseCode + APPLICATION_CLOSE_CODE_OFFSET;
  }
  return 4000;
}

export class ProtocolTerminalAdapter implements TerminalAdapter {
  readonly kind = "protocol-client" as const;
  readonly supportsPairing = true;
  readonly label: string;
  private readonly policy;
  private credentialStore?: CredentialStore;
  private readonly cryptoProvider: Crypto;
  private readonly getCurrentOrigin: () => string;
  private readonly monotonicNow: () => number;
  private readonly now: () => number;
  private readonly webSocketFactory: (
    url: string,
    subprotocol: string,
  ) => WebSocketPort;
  private readonly stateListeners = new Set<
    (state: TerminalConnectionState) => void
  >();
  private readonly outputListeners = new Set<(output: string) => void>();
  private readonly sessionListeners = new Set<
    (event: TerminalSessionEvent) => void
  >();
  private state: TerminalConnectionState = "disconnected";
  private errorCode?: ProtocolErrorCode;
  private viewport: TerminalViewport = { columns: 80, rows: 24 };
  private socket?: WebSocketPort;
  private machine = new ProtocolContractMachine();
  private credential?: StoredCredential;
  private connectionId?: string;
  private sessionId?: string;
  private requestedSessionId?: string;
  private newSessionOperation?: NewSessionOperation;
  private lastInboundAt = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private authorizationTimer?: ReturnType<typeof setTimeout>;
  private inboundQueue = Promise.resolve();

  constructor(config: ProtocolTerminalAdapterConfig) {
    this.cryptoProvider = config.cryptoProvider ?? globalThis.crypto;
    this.getCurrentOrigin =
      config.getCurrentOrigin ??
      (() =>
        typeof window === "undefined"
          ? config.expectedWebOrigin
          : window.location.origin);
    this.now = config.now ?? Date.now;
    this.monotonicNow =
      config.monotonicNow ?? (() => globalThis.performance.now());
    this.policy = validatePrivateWssPolicy(config, this.getCurrentOrigin());
    this.credentialStore = config.credentialStore;
    this.webSocketFactory =
      config.webSocketFactory ??
      ((url, subprotocol) =>
        new WebSocket(url, subprotocol) as unknown as WebSocketPort);
    this.label = `PRIVATE WSS · PROTOCOL 0.2 · ${new URL(this.policy.endpoint).host}`;
  }

  async connect(options: TerminalConnectOptions = {}): Promise<void> {
    if (options.destination !== undefined) {
      try {
        if (new URL(options.destination).href !== this.policy.endpoint) {
          throw new ProtocolViolation("ORIGIN_REJECTED", 1008);
        }
      } catch (error) {
        throw error instanceof ProtocolViolation
          ? error
          : new ProtocolViolation("ORIGIN_REJECTED", 1008);
      }
    }
    if (!["disconnected", "detached", "error"].includes(this.state)) return;

    this.errorCode = undefined;
    const requestedSessionId =
      options.sessionId ??
      (this.state === "detached" ? this.sessionId : undefined);
    if (requestedSessionId !== undefined && !isSessionId(requestedSessionId)) {
      const violation = new ProtocolViolation("SESSION_REOPEN_REJECTED", 1008);
      this.errorCode = violation.code;
      this.setState("error");
      throw violation;
    }
    this.requestedSessionId = requestedSessionId;
    this.setState(
      requestedSessionId === undefined ? "connecting" : "reconnecting",
    );

    let clientInstanceId: string;
    try {
      const credentialStore = this.getCredentialStore();
      this.credential = await credentialStore.loadCredential();
      clientInstanceId = await credentialStore.getClientInstanceId();
    } catch (error) {
      const violation = asProtocolViolation(error, "AUTHENTICATION_FAILED");
      this.errorCode = violation.code;
      this.setState("error");
      throw violation;
    }
    this.connectionId = this.cryptoProvider.randomUUID().toLowerCase();
    this.machine = new ProtocolContractMachine({
      connectionState: "NEW",
      sessionState: "NONE",
      nextSequence: { client_to_agent: 0, agent_to_client: 0 },
    });

    await new Promise<void>((resolve, reject) => {
      const socket = this.webSocketFactory(
        this.policy.endpoint,
        PROTOCOL_SUBPROTOCOL,
      );
      this.socket = socket;
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (socket.protocol !== PROTOCOL_SUBPROTOCOL) {
          const violation = new ProtocolViolation("UNSUPPORTED_VERSION", 1002);
          this.fail(violation);
          reject(violation);
          return;
        }
        void this.sendFrame("hello", {
          clientInstanceId,
          ...(this.credential === undefined
            ? {}
            : { credentialId: this.credential.credentialId }),
          supportedVersions: [PROTOCOL_VERSION],
        })
          .then(resolve)
          .catch((error: unknown) => {
            const violation = asProtocolViolation(error);
            this.fail(violation);
            reject(violation);
          });
      };
      socket.onerror = () => {
        const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
        this.fail(failure);
        reject(failure);
      };
      socket.onmessage = (event) => {
        this.inboundQueue = this.inboundQueue
          .then(() => this.receive(event.data))
          .catch((error: unknown) => this.fail(asProtocolViolation(error)));
      };
      socket.onclose = () => {
        if (this.socket === socket) this.handleTransportClose();
      };
    });
  }

  async pair(pairingCode: string): Promise<void> {
    if (this.state !== "pairing") {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    try {
      await this.sendFrame("pairing_request", { pairingCode });
      this.setState("authenticating");
    } finally {
      pairingCode = "";
    }
  }

  async detach(): Promise<void> {
    if (this.state !== "connected" || this.sessionId === undefined) return;
    this.setState("detaching");
    await this.sendFrame("detach", { sessionId: this.sessionId });
  }

  async disconnect(): Promise<void> {
    this.stopHeartbeat();
    this.clearAuthorizationTimer();
    if (
      this.state === "connected" &&
      this.sessionId !== undefined &&
      this.socket?.readyState === SOCKET_OPEN
    ) {
      this.setState("closing");
      await this.sendFrame("close_session", {
        sessionId: this.sessionId,
        reason: "user_request",
      });
      return;
    }
    this.sessionId = undefined;
    this.requestedSessionId = undefined;
    this.socket?.close(1000, "user_request");
    this.setState("disconnected");
  }

  async newSession(): Promise<void> {
    if (
      this.state !== "connected" ||
      this.sessionId === undefined ||
      this.newSessionOperation !== undefined
    ) {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    const completion = new Promise<void>((resolve, reject) => {
      this.newSessionOperation = {
        phase: "closing",
        resolve,
        reject: (error) => reject(error),
      };
    });
    this.setState("closing");
    try {
      await this.sendFrame("close_session", {
        sessionId: this.sessionId,
        reason: "new_session",
      });
    } catch (error) {
      this.rejectNewSession(asProtocolViolation(error));
    }
    return completion;
  }

  getErrorCode(): string | undefined {
    return this.errorCode;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  getState(): TerminalConnectionState {
    return this.state;
  }

  resize(viewport: TerminalViewport): void {
    if (
      !Number.isInteger(viewport.columns) ||
      !Number.isInteger(viewport.rows) ||
      viewport.columns < 1 ||
      viewport.columns > 1000 ||
      viewport.rows < 1 ||
      viewport.rows > 1000
    ) {
      throw new RangeError(
        "Terminal viewport dimensions must be integers from 1 through 1000.",
      );
    }
    this.viewport = viewport;
    if (this.state === "connected" && this.sessionId !== undefined) {
      void this.sendFrame("resize", {
        sessionId: this.sessionId,
        dimensions: viewport,
      }).catch((error: unknown) => this.fail(asProtocolViolation(error)));
    }
  }

  sendInput(data: string): void {
    if (this.state !== "connected" || this.sessionId === undefined) {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    const bytes = new TextEncoder().encode(data);
    if (bytes.length > MAX_TERMINAL_INPUT_BYTES) {
      throw new ProtocolViolation("PAYLOAD_TOO_LARGE", 1009);
    }
    if (bytes.length === 0) return;
    void this.sendFrame("terminal_input", {
      sessionId: this.sessionId,
      data: encodeBase64Url(bytes),
    }).catch((error: unknown) => this.fail(asProtocolViolation(error)));
  }

  subscribe(listener: (state: TerminalConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  subscribeOutput(listener: (output: string) => void): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  subscribeSession(
    listener: (event: TerminalSessionEvent) => void,
  ): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private async receive(data: string | ArrayBuffer | Blob): Promise<void> {
    if (typeof data !== "string") {
      throw new ProtocolViolation("SCHEMA_INVALID", 1002);
    }
    const frame = await this.machine.apply("agent_to_client", data);
    this.lastInboundAt = this.monotonicNow();

    switch (frame.type) {
      case "hello_ack":
        if (this.credential === undefined) {
          this.setState("pairing");
        } else {
          this.setState("authenticating");
        }
        break;
      case "pairing_result": {
        const rawSecret = String(frame.payload.credentialSecret);
        try {
          this.credential = await this.getCredentialStore().saveCredential(
            String(frame.payload.credentialId),
            rawSecret,
            String(frame.payload.credentialExpiresAt),
          );
          frame.payload.credentialSecret = "";
          this.setState("authenticating");
        } catch {
          throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
        }
        break;
      }
      case "auth_challenge":
        await this.answerChallenge(frame);
        break;
      case "auth_result":
        if (
          !this.scheduleAuthorizationExpiry(
            String(frame.payload.authorizationExpiresAt),
          )
        ) {
          throw new ProtocolViolation("AUTHORIZATION_EXPIRED", 1008);
        }
        await this.openOrReopen();
        break;
      case "session_opened":
        this.sessionId = String(frame.payload.sessionId);
        this.requestedSessionId = undefined;
        this.setState("connected");
        this.startHeartbeat();
        this.emitSession({ type: "session-opened", sessionId: this.sessionId });
        this.resolveNewSession();
        break;
      case "session_reopened":
        if (frame.payload.sessionId !== this.requestedSessionId) {
          throw new ProtocolViolation("SESSION_REOPEN_REJECTED", 1008);
        }
        this.sessionId = String(frame.payload.sessionId);
        this.setState("replaying");
        this.emitSession({
          type: "session-reopened",
          sessionId: this.sessionId,
        });
        break;
      case "history_begin":
        if (frame.payload.sessionId !== this.sessionId) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.emitSession({
          type: "history-begin",
          sessionId: String(frame.payload.sessionId),
          truncated: frame.payload.truncated === true,
        });
        break;
      case "history_chunk":
        if (frame.payload.sessionId !== this.sessionId) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.emitOutput(
          textDecoder.decode(decodeBase64Url(frame.payload.data)),
        );
        break;
      case "history_end":
        if (frame.payload.sessionId !== this.sessionId) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.setState("connected");
        this.startHeartbeat();
        break;
      case "terminal_output":
        if (frame.payload.sessionId !== this.sessionId) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.emitOutput(
          textDecoder.decode(decodeBase64Url(frame.payload.data)),
        );
        break;
      case "heartbeat":
        if (frame.payload.kind === "ping") {
          await this.sendFrame("heartbeat", {
            kind: "pong",
            nonce: frame.payload.nonce,
          });
        }
        break;
      case "session_detached":
        if (frame.payload.sessionId !== this.sessionId) {
          throw new ProtocolViolation("INVALID_STATE", 1008);
        }
        this.stopHeartbeat();
        this.clearAuthorizationTimer();
        this.setState("detached");
        this.socket?.close(1000, "detached");
        break;
      case "session_closed":
        this.stopHeartbeat();
        this.clearAuthorizationTimer();
        if (this.newSessionOperation?.phase === "closing") {
          if (frame.payload.reason !== "new_session") {
            const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
            this.errorCode = failure.code;
            this.rejectNewSession(failure);
            this.setState("error");
            this.socket?.close(browserCloseCode(1008), failure.code);
            break;
          }
          const oldSocket = this.socket;
          this.sessionId = undefined;
          this.requestedSessionId = undefined;
          this.newSessionOperation.phase = "opening";
          this.setState("disconnected");
          oldSocket?.close(1000, "new_session");
          queueMicrotask(() => {
            void this.connect().catch((error: unknown) =>
              this.rejectNewSession(asProtocolViolation(error)),
            );
          });
          break;
        }
        this.sessionId = undefined;
        this.requestedSessionId = undefined;
        this.socket?.close(1000, "session_closed");
        this.setState("disconnected");
        break;
      case "error": {
        const code = protocolErrorCode(frame.payload.code) ?? "SCHEMA_INVALID";
        this.errorCode = code;
        this.stopHeartbeat();
        this.rejectNewSession(new ProtocolViolation(code, 1008));
        this.setState("error");
        this.socket?.close(browserCloseCode(1008), code);
        break;
      }
    }
  }

  private async answerChallenge(frame: ProtocolFrame): Promise<void> {
    if (this.credential === undefined) {
      throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
    }
    // Protocol timeouts use a local monotonic clock. The wire timestamp is
    // schema-validated metadata, but comparing it to the browser wall clock
    // makes a valid fresh challenge fail when the phone and agent clocks differ.
    const monotonicDeadline = this.monotonicNow() + AUTH_CHALLENGE_LIFETIME_MS;
    const proof = await computeAuthenticationProof(
      this.credential.key,
      frame.connectionId,
      String(frame.payload.challengeId),
      String(frame.payload.challenge),
      this.cryptoProvider,
    );
    if (this.monotonicNow() >= monotonicDeadline) {
      throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
    }
    await this.sendFrame("auth_response", {
      challengeId: frame.payload.challengeId,
      credentialId: this.credential.credentialId,
      proof,
    });
    this.setState("authenticating");
  }

  private async openOrReopen(): Promise<void> {
    this.setState("opening");
    if (this.requestedSessionId !== undefined) {
      await this.sendFrame("reopen_session", {
        sessionId: this.requestedSessionId,
        dimensions: this.viewport,
      });
      return;
    }
    await this.sendFrame("open_session", {
      shell: "powershell",
      dimensions: this.viewport,
    });
  }

  private async sendFrame(
    type: ProtocolFrame["type"],
    payload: Record<string, unknown>,
  ) {
    if (
      this.socket === undefined ||
      this.socket.readyState !== SOCKET_OPEN ||
      this.connectionId === undefined
    ) {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    const frame: ProtocolFrame = {
      version: PROTOCOL_VERSION,
      type,
      connectionId: this.connectionId,
      sequence: this.machine.getSnapshot().nextSequence.client_to_agent,
      payload,
    };
    const serialized = JSON.stringify(frame);
    const frameBytes = new TextEncoder().encode(serialized).length;
    if (frameBytes > MAX_FRAME_BYTES) {
      throw new ProtocolViolation("FRAME_TOO_LARGE", 1009);
    }
    if (this.socket.bufferedAmount + frameBytes > MAX_OUTBOUND_BUFFERED_BYTES) {
      throw new ProtocolViolation("BACKPRESSURE_LIMIT", 1008);
    }
    await this.machine.apply("client_to_agent", frame);
    this.socket.send(serialized);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastInboundAt = this.monotonicNow();
    this.heartbeatTimer = setInterval(() => {
      if (this.monotonicNow() - this.lastInboundAt >= HEARTBEAT_LIVENESS_MS) {
        this.fail(new ProtocolViolation("HEARTBEAT_TIMEOUT", 1008));
        return;
      }
      const nonce = new Uint8Array(16);
      this.cryptoProvider.getRandomValues(nonce);
      void this.sendFrame("heartbeat", {
        kind: "ping",
        nonce: encodeBase64Url(nonce),
      }).catch((error: unknown) => this.fail(asProtocolViolation(error)));
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private fail(violation: ProtocolViolation): void {
    if (this.state === "error") return;
    this.errorCode = violation.code;
    this.rejectNewSession(violation);
    this.stopHeartbeat();
    this.clearAuthorizationTimer();
    const socket = this.socket;
    if (
      socket?.readyState === SOCKET_OPEN &&
      this.machine.getSnapshot().connectionState !== "CLOSED"
    ) {
      void this.sendFrame("error", { code: violation.code, fatal: true })
        .catch(() => undefined)
        .finally(() =>
          socket.close(browserCloseCode(violation.closeCode), violation.code),
        );
    } else {
      socket?.close(browserCloseCode(violation.closeCode), violation.code);
    }
    this.setState("error");
  }

  private handleTransportClose(): void {
    this.stopHeartbeat();
    this.clearAuthorizationTimer();
    if (["disconnected", "detached", "error"].includes(this.state)) return;
    if (this.newSessionOperation !== undefined) {
      const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
      this.errorCode = failure.code;
      this.rejectNewSession(failure);
      this.setState("error");
      return;
    }
    if (this.sessionId !== undefined) {
      this.setState("detached");
      return;
    }
    this.errorCode = "SESSION_OPEN_FAILED";
    this.setState("error");
  }

  private setState(state: TerminalConnectionState): void {
    this.state = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  private emitOutput(output: string): void {
    this.outputListeners.forEach((listener) => listener(output));
  }

  private emitSession(event: TerminalSessionEvent): void {
    this.sessionListeners.forEach((listener) => listener(event));
  }

  private resolveNewSession(): void {
    if (this.newSessionOperation?.phase !== "opening") return;
    const operation = this.newSessionOperation;
    this.newSessionOperation = undefined;
    operation.resolve();
  }

  private rejectNewSession(violation: ProtocolViolation): void {
    const operation = this.newSessionOperation;
    if (operation === undefined) return;
    this.newSessionOperation = undefined;
    operation.reject(violation);
  }

  private getCredentialStore(): CredentialStore {
    if (this.credentialStore !== undefined) return this.credentialStore;
    if (typeof indexedDB === "undefined") {
      throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
    }
    this.credentialStore = new IndexedDbCredentialStore(
      indexedDB,
      this.cryptoProvider,
      this.now,
    );
    return this.credentialStore;
  }

  private scheduleAuthorizationExpiry(expiresAt: string): boolean {
    this.clearAuthorizationTimer();
    // The server remains authoritative and closes the connection at its own
    // monotonic authorization deadline. The timestamp is wire metadata; using
    // it with the phone's wall clock can immediately expire a fresh grant when
    // the two devices differ even slightly.
    if (!Number.isFinite(new Date(expiresAt).valueOf())) return false;
    this.authorizationTimer = setTimeout(
      () => this.fail(new ProtocolViolation("AUTHORIZATION_EXPIRED", 1008)),
      AUTHORIZATION_LIFETIME_MS,
    );
    return true;
  }

  private clearAuthorizationTimer(): void {
    if (this.authorizationTimer !== undefined) {
      clearTimeout(this.authorizationTimer);
    }
    this.authorizationTimer = undefined;
  }
}

function asProtocolViolation(
  error: unknown,
  fallback: ProtocolErrorCode = "SCHEMA_INVALID",
): ProtocolViolation {
  return error instanceof ProtocolViolation
    ? error
    : new ProtocolViolation(
        fallback,
        fallback === "SCHEMA_INVALID" ? 1002 : 1008,
      );
}
