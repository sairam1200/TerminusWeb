import { computeAuthenticationProof } from "../protocol/auth";
import { RecentSessions } from "../protocol/recentSessions";
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
  validateWssPolicy,
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
class TerminalTransportError extends Error {}

interface NewSessionOperation {
  phase: "closing" | "opening";
  resolve: () => void;
  reject: (error: ProtocolViolation) => void;
}

interface ConnectionWork {
  tail: Promise<void>;
  outboundBytes: number;
}

// Pairing keys use one protected store per page origin. Order terminal adapter
// loads/saves across replacements so a late old save cannot overwrite a newer
// pairing. Queued work checks ownership again before starting a store mutation.
let credentialOperations = Promise.resolve();
function withCredentialStore<T>(operation: () => Promise<T>): Promise<T> {
  const result = credentialOperations.then(operation);
  credentialOperations = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
  private failureCause?: "transport";
  private viewport: TerminalViewport = { columns: 80, rows: 24 };
  private socket?: WebSocketPort;
  private machine = new ProtocolContractMachine();
  private credential?: StoredCredential;
  private readonly recent = new RecentSessions();
  private cancelConnect?: () => void;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private connectionId?: string;
  private sessionId?: string;
  private requestedSessionId?: string;
  private newSessionOperation?: NewSessionOperation;
  private lastInboundAt = 0;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private authorizationTimer?: ReturnType<typeof setTimeout>;
  private inboundQueue = Promise.resolve();
  private work: ConnectionWork = { tail: Promise.resolve(), outboundBytes: 0 };

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
    this.policy = validateWssPolicy(config, this.getCurrentOrigin());
    this.credentialStore = config.credentialStore;
    this.webSocketFactory =
      config.webSocketFactory ??
      ((url, subprotocol) =>
        new WebSocket(url, subprotocol) as unknown as WebSocketPort);
    this.label = `${this.policy.mode === "local" ? "LOCAL" : "PRIVATE"} WSS · PROTOCOL 0.2 · ${new URL(this.policy.endpoint).host}`;
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

    const work: ConnectionWork = { tail: Promise.resolve(), outboundBytes: 0 };
    this.clearConnectTimer();
    this.work = work;
    this.inboundQueue = Promise.resolve();

    this.errorCode = undefined;
    this.failureCause = undefined;
    const requestedSessionId =
      options.sessionId ?? this.requestedSessionId ?? this.sessionId;
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
      const stored = await withCredentialStore(async () => {
        if (this.work !== work) return;
        const credentialStore = this.getCredentialStore();
        const credential = await credentialStore.loadCredential();
        const clientInstanceId = await credentialStore.getClientInstanceId();
        return { credential, clientInstanceId };
      });
      if (!stored || this.work !== work) return;
      this.credential = stored.credential;
      clientInstanceId = stored.clientInstanceId;
    } catch (error) {
      if (this.work !== work) return;
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
      this.cancelConnect = () =>
        reject(new Error("Terminal connection released."));
      let socket: WebSocketPort;
      try {
        socket = this.webSocketFactory(
          this.policy.endpoint,
          PROTOCOL_SUBPROTOCOL,
        );
      } catch {
        this.failureCause = "transport";
        const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
        this.release();
        reject(failure);
        return;
      }
      this.socket = socket;
      this.connectTimer = setTimeout(() => {
        if (this.socket === socket && this.work === work) this.release();
      }, 10000);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        if (this.socket !== socket || this.work !== work) return;
        this.clearConnectTimer();
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
          .then(() => {
            if (this.work === work) this.cancelConnect = undefined;
            resolve();
          })
          .catch((error: unknown) => {
            if (this.socket !== socket || this.work !== work) return;
            const violation = asProtocolViolation(error);
            this.handleSendFailure(error);
            reject(violation);
          });
      };
      socket.onerror = () => {
        if (
          this.socket !== socket ||
          this.work !== work ||
          this.state === "error"
        )
          return;
        this.failureCause = "transport";
        const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
        this.release();
        reject(failure);
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket || this.work !== work) return;
        this.inboundQueue = this.inboundQueue
          .then(() => this.receive(event.data, socket, work))
          .catch((error: unknown) => {
            if (this.socket === socket && this.work === work)
              this.handleSendFailure(error);
          });
      };
      socket.onclose = () => {
        if (this.socket === socket && this.work === work) {
          this.clearConnectTimer();
          this.handleTransportClose();
          reject(new Error("Terminal transport closed."));
        }
      };
    });
  }

  async pair(pairingCode: string): Promise<void> {
    if (this.state !== "pairing") {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    const work = this.work;
    try {
      await this.sendFrame("pairing_request", { pairingCode });
      if (this.work === work) this.setState("authenticating");
    } finally {
      pairingCode = "";
    }
  }

  async detach(): Promise<void> {
    if (this.state !== "connected" || this.sessionId === undefined) return;
    this.setState("detaching");
    await this.sendFrame("detach", { sessionId: this.sessionId });
  }

  // Transport release preserves the host shell and locator; no fatal frame.
  release(): void {
    this.clearConnectTimer();
    this.cancelConnect?.();
    this.cancelConnect = undefined;
    this.stopHeartbeat();
    this.clearAuthorizationTimer();
    const socket = this.socket;
    this.socket = undefined;
    this.work = { tail: Promise.resolve(), outboundBytes: 0 };
    socket?.close(1000, "transport_release");
    this.failureCause = "transport";
    if (this.newSessionOperation) {
      this.errorCode = "SESSION_OPEN_FAILED";
      this.rejectNewSession(new ProtocolViolation("SESSION_OPEN_FAILED", 1008));
      this.setState("error");
    } else if (this.sessionId || this.requestedSessionId)
      this.setState("detached");
    else {
      this.errorCode = "SESSION_OPEN_FAILED";
      this.setState("error");
    }
  }

  async getRecentSessions() {
    const credential = await withCredentialStore(() =>
      this.getCredentialStore().loadCredential(),
    ).catch(() => undefined);
    return credential
      ? this.recent.list(this.recentScope(), credential.credentialId)
      : [];
  }

  private clearConnectTimer(): void {
    clearTimeout(this.connectTimer);
    this.connectTimer = undefined;
  }

  private recentScope(): string {
    return JSON.stringify([
      this.policy.mode,
      this.policy.endpoint,
      this.policy.expectedWebOrigin,
    ]);
  }

  private rememberSession(sessionId: string, ended = false): void {
    if (this.credential)
      this.recent.update(
        this.recentScope(),
        this.credential.credentialId,
        sessionId,
        ended ? undefined : this.now(),
      );
  }

  async disconnect(): Promise<void> {
    this.clearConnectTimer();
    this.stopHeartbeat();
    this.clearAuthorizationTimer();
    if (
      this.state === "connected" &&
      this.sessionId !== undefined &&
      this.socket?.readyState === SOCKET_OPEN
    ) {
      this.setState("closing");
      const work = this.work;
      try {
        await this.sendFrame("close_session", {
          sessionId: this.sessionId,
          reason: "user_request",
        });
      } catch (error) {
        if (this.work === work) this.handleSendFailure(error);
        throw error;
      }
      return;
    }
    this.sessionId = undefined;
    this.requestedSessionId = undefined;
    this.rejectNewSession(new ProtocolViolation("INVALID_STATE", 1008));
    const socket = this.socket;
    this.socket = undefined;
    this.work = { tail: Promise.resolve(), outboundBytes: 0 };
    socket?.close(1000, "user_request");
    this.setState("disconnected");
  }

  async newSession(): Promise<void> {
    if (
      this.state === "error" &&
      this.errorCode === "SESSION_REOPEN_REJECTED" &&
      this.newSessionOperation === undefined
    ) {
      // Explicit recovery opens a separate shell. Do not send close for a
      // rejected locator, and leave its browser fragment until session-opened.
      const completion = new Promise<void>((resolve, reject) => {
        this.newSessionOperation = { phase: "opening", resolve, reject };
      });
      this.sessionId = undefined;
      this.requestedSessionId = undefined;
      const oldSocket = this.socket;
      this.socket = undefined;
      oldSocket?.close(1000, "new_session");
      this.setState("disconnected");
      const operation = this.newSessionOperation;
      void this.connect().catch((error: unknown) => {
        if (this.newSessionOperation === operation)
          this.rejectNewSession(asProtocolViolation(error));
      });
      return completion;
    }
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
    const work = this.work;
    const operation = this.newSessionOperation;
    try {
      await this.sendFrame("close_session", {
        sessionId: this.sessionId,
        reason: "new_session",
      });
    } catch (error) {
      if (this.work !== work || this.newSessionOperation !== operation)
        return completion;
      this.rejectNewSession(asProtocolViolation(error));
      // The close frame was not queued, so the existing session is still the
      // attached retry target and its fragment remains valid.
      this.setState("connected");
    }
    return completion;
  }

  getErrorCode(): string | undefined {
    return this.errorCode;
  }
  getFailureCause(): "transport" | undefined {
    return this.failureCause;
  }

  getSessionId(): string | undefined {
    return this.sessionId ?? this.requestedSessionId;
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
      const work = this.work;
      void this.sendFrame("resize", {
        sessionId: this.sessionId,
        dimensions: viewport,
      }).catch((error: unknown) => {
        if (this.work === work) this.handleSendFailure(error);
      });
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
    const work = this.work;
    void this.sendFrame("terminal_input", {
      sessionId: this.sessionId,
      data: encodeBase64Url(bytes),
    }).catch((error: unknown) => {
      if (this.work === work) this.handleSendFailure(error);
    });
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

  private async receive(
    data: string | ArrayBuffer | Blob,
    socket: WebSocketPort,
    work: ConnectionWork,
  ): Promise<void> {
    if (this.socket !== socket || this.work !== work || this.state === "error")
      return;
    if (typeof data !== "string") {
      throw new ProtocolViolation("SCHEMA_INVALID", 1002);
    }
    const frame = await this.withMachine(work, async () => {
      if (
        this.socket !== socket ||
        this.work !== work ||
        this.state === "error"
      )
        return;
      return this.machine.apply("agent_to_client", data);
    });
    if (!frame || this.socket !== socket || this.work !== work) return;
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
          const credential = await withCredentialStore(async () => {
            if (this.socket !== socket || this.work !== work) return;
            return this.getCredentialStore().saveCredential(
              String(frame.payload.credentialId),
              rawSecret,
              String(frame.payload.credentialExpiresAt),
            );
          });
          frame.payload.credentialSecret = "";
          if (!credential || this.socket !== socket || this.work !== work)
            return;
          this.credential = credential;
          this.setState("authenticating");
        } catch {
          throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
        }
        break;
      }
      case "auth_challenge":
        await this.answerChallenge(frame, socket, work);
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
        this.rememberSession(this.sessionId);
        this.requestedSessionId = undefined;
        this.startHeartbeat();
        this.setState("connected");
        if (this.socket !== socket || this.work !== work) return;
        this.emitSession({ type: "session-opened", sessionId: this.sessionId });
        this.resolveNewSession();
        break;
      case "session_reopened":
        if (frame.payload.sessionId !== this.requestedSessionId) {
          throw new ProtocolViolation("SESSION_REOPEN_REJECTED", 1008);
        }
        this.sessionId = String(frame.payload.sessionId);
        this.rememberSession(this.sessionId);
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
        this.startHeartbeat();
        this.setState("connected");
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
        this.rememberSession(String(frame.payload.sessionId), true);
        this.emitSession({
          type: "session-ended",
          sessionId: String(frame.payload.sessionId),
        });
        this.stopHeartbeat();
        this.clearAuthorizationTimer();
        if (this.newSessionOperation?.phase === "closing") {
          if (frame.payload.reason !== "new_session") {
            const failure = new ProtocolViolation("SESSION_OPEN_FAILED", 1008);
            this.errorCode = failure.code;
            this.sessionId = undefined;
            this.requestedSessionId = undefined;
            this.rejectNewSession(failure);
            this.setState("error");
            this.socket?.close(browserCloseCode(1008), failure.code);
            break;
          }
          const oldSocket = this.socket;
          this.sessionId = undefined;
          this.requestedSessionId = undefined;
          this.newSessionOperation.phase = "opening";
          const operation = this.newSessionOperation;
          this.setState("disconnected");
          oldSocket?.close(1000, "new_session");
          queueMicrotask(() => {
            if (this.work !== work || this.newSessionOperation !== operation)
              return;
            void this.connect().catch((error: unknown) => {
              if (this.newSessionOperation === operation)
                this.rejectNewSession(asProtocolViolation(error));
            });
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
        if (code === "HEARTBEAT_TIMEOUT" || code === "AUTHORIZATION_EXPIRED") {
          this.release();
          break;
        }
        this.errorCode = code;
        this.stopHeartbeat();
        this.rejectNewSession(new ProtocolViolation(code, 1008));
        this.setState("error");
        this.socket?.close(browserCloseCode(1008), code);
        break;
      }
    }
  }

  private async answerChallenge(
    frame: ProtocolFrame,
    socket: WebSocketPort,
    work: ConnectionWork,
  ): Promise<void> {
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
    if (this.socket !== socket || this.work !== work) return;
    if (this.monotonicNow() >= monotonicDeadline) {
      throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
    }
    await this.sendFrame("auth_response", {
      challengeId: frame.payload.challengeId,
      credentialId: this.credential.credentialId,
      proof,
    });
    if (this.socket !== socket || this.work !== work) return;
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

  private withMachine<T>(
    work: ConnectionWork,
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = work.tail.then(operation);
    work.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async sendFrame(
    type: ProtocolFrame["type"],
    payload: Record<string, unknown>,
  ) {
    if (this.socket === undefined || this.connectionId === undefined) {
      throw new ProtocolViolation("INVALID_STATE", 1008);
    }
    const socket = this.socket;
    if (socket.readyState !== SOCKET_OPEN)
      throw new TerminalTransportError("Terminal transport closed.");
    const work = this.work;
    // Own the queued payload so later caller mutations cannot bypass the byte
    // reservation or change an already accepted resize/input operation.
    payload = structuredClone(payload);
    // Reserve a conservative encoded size before queueing. A largest-safe
    // sequence placeholder bounds the eventual frame without allocating it yet.
    const reservation = new TextEncoder().encode(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        type,
        connectionId: this.connectionId,
        sequence: Number.MAX_SAFE_INTEGER,
        payload,
      }),
    ).length;
    if (reservation > MAX_FRAME_BYTES) {
      throw new ProtocolViolation("FRAME_TOO_LARGE", 1009);
    }
    if (
      socket.bufferedAmount + work.outboundBytes + reservation >
      MAX_OUTBOUND_BUFFERED_BYTES
    ) {
      throw new ProtocolViolation("BACKPRESSURE_LIMIT", 1008);
    }
    work.outboundBytes += reservation;
    try {
      await this.withMachine(work, async () => {
        if (
          this.socket !== socket ||
          this.work !== work ||
          (this.state === "error" && type !== "error")
        )
          return;
        if (socket.readyState !== SOCKET_OPEN)
          throw new TerminalTransportError("Terminal transport closed.");
        const machine = this.machine;
        const previousMachine = machine.getSnapshot();
        const frame: ProtocolFrame = {
          version: PROTOCOL_VERSION,
          type,
          connectionId: this.connectionId!,
          sequence: previousMachine.nextSequence.client_to_agent,
          payload,
        };
        const serialized = JSON.stringify(frame);
        if (
          socket.bufferedAmount + new TextEncoder().encode(serialized).length >
          MAX_OUTBOUND_BUFFERED_BYTES
        )
          throw new ProtocolViolation("BACKPRESSURE_LIMIT", 1008);
        await machine.apply("client_to_agent", frame);
        if (this.socket !== socket || this.work !== work) return;
        try {
          socket.send(serialized);
        } catch {
          // Both-direction machine transitions share this lock, so rollback
          // cannot erase an incoming frame committed during an await.
          if (this.socket === socket && this.work === work)
            this.machine = new ProtocolContractMachine(previousMachine);
          throw new TerminalTransportError("Terminal transport send failed.");
        }
      });
    } catch (error) {
      if (this.socket === socket && this.work === work) throw error;
    } finally {
      work.outboundBytes -= reservation;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastInboundAt = this.monotonicNow();
    const work = this.work;
    this.heartbeatTimer = setInterval(() => {
      if (this.work !== work) return;
      if (this.monotonicNow() - this.lastInboundAt >= HEARTBEAT_LIVENESS_MS) {
        this.release();
        return;
      }
      const nonce = new Uint8Array(16);
      this.cryptoProvider.getRandomValues(nonce);
      void this.sendFrame("heartbeat", {
        kind: "ping",
        nonce: encodeBase64Url(nonce),
      }).catch((error: unknown) => {
        if (this.work === work) this.handleSendFailure(error);
      });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  private handleSendFailure(error: unknown): void {
    if (error instanceof TerminalTransportError) this.release();
    else this.fail(asProtocolViolation(error));
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
    this.failureCause = "transport";
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
      () => this.release(),
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
