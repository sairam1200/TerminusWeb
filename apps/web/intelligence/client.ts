import { validRequest } from "./request";
import { validResult } from "./validate";
import { decodeBase64Url, encodeBase64Url, isUuidV4 } from "../protocol/codec";
import {
  IndexedDbCredentialStore,
  type CredentialStore,
} from "../protocol/credentialStore";
import {
  validateWssPolicy,
  type PrivateWssPolicy,
} from "../protocol/endpointPolicy";
import type { IntelligenceApi, IntelligenceState, Rpc } from "./types";

const ERRORS = new Set([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNAVAILABLE",
  "RATE_LIMITED",
  "CONSENT_REQUIRED",
  "CONFLICT",
  "QUOTA_EXCEEDED",
]);
export function intelligenceEndpoint(
  policy: PrivateWssPolicy,
  origin: string,
): string {
  const url = new URL(validateWssPolicy(policy, origin).endpoint);
  if (url.pathname !== "/terminal") throw new Error("UNAVAILABLE");
  url.pathname = "/intelligence";
  return url.href;
}
export async function intelligenceProof(
  key: CryptoKey,
  connectionId: string,
  challengeId: string,
  challenge: string,
  provider: Crypto = crypto,
): Promise<string> {
  const prefix = new TextEncoder().encode(
    `Terminus/intelligence/1/auth\0${connectionId}\0${challengeId}\0`,
  );
  const nonce = decodeBase64Url(challenge, 32);
  const message = new Uint8Array(prefix.length + nonce.length);
  message.set(prefix);
  message.set(nonce, prefix.length);
  return encodeBase64Url(
    new Uint8Array(await provider.subtle.sign("HMAC", key, message)),
  );
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return (
    Object.keys(value).length === keys.length && keys.every((k) => k in value)
  );
}
export function validCommand(command: string): boolean {
  return (
    command.trim().length > 0 &&
    new TextEncoder().encode(command).length <= 4096 &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(command)
  );
}

export class IntelligenceClient implements IntelligenceApi {
  private socket?: WebSocket;
  private disposed = false;
  private generation = 0;
  private attempts = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private state: IntelligenceState = "disconnected";
  private listeners = new Set<(state: IntelligenceState) => void>();
  private pending = new Map<
    string,
    {
      method: keyof Rpc;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly policy: PrivateWssPolicy,
    private readonly origin: string,
    private readonly credentials: CredentialStore = new IndexedDbCredentialStore(),
    private readonly socketFactory: (
      url: string,
      protocol: string,
    ) => WebSocket = (u, p) => new WebSocket(u, p),
  ) {}
  subscribe(listener: (state: IntelligenceState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getState() {
    return this.state;
  }
  private setState(state: IntelligenceState) {
    this.state = state;
    this.listeners.forEach((l) => l(state));
  }
  connect() {
    if (this.disposed) return;
    if (this.socket) {
      // A healthy transport can outlive a transient database failure. Notify
      // subscribers so manual retry refreshes the current private session.
      if (this.state === "ready") this.setState("ready");
      return;
    }
    clearTimeout(this.retryTimer);
    this.attempts = 0;
    void this.open();
  }
  private async open() {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.setState("connecting");
    let url: string;
    let credential;
    try {
      url = intelligenceEndpoint(this.policy, this.origin);
      credential = await this.credentials.loadCredential();
    } catch {
      this.setState("unavailable");
      return;
    }
    if (this.disposed || generation !== this.generation) return;
    if (!credential) {
      this.setState("pairing-required");
      return;
    }
    let socket: WebSocket;
    try {
      socket = this.socketFactory(url, "terminus.intelligence.v1");
    } catch {
      this.failed();
      return;
    }
    this.socket = socket;
    let phase: "challenge" | "signing" | "ready" | "active" = "challenge";
    this.handshakeTimer = setTimeout(() => socket.close(), 10000);
    socket.onmessage = async (event) => {
      if (this.socket !== socket || this.disposed) return;
      try {
        if (socket.protocol !== "terminus.intelligence.v1") throw new Error();
        if (
          typeof event.data !== "string" ||
          new TextEncoder().encode(event.data).length > 65536
        )
          throw new Error();
        const frame: Record<string, unknown> = JSON.parse(event.data);
        if (!frame || typeof frame !== "object" || Array.isArray(frame))
          throw new Error();
        if (phase === "challenge") {
          if (
            !exact(frame, [
              "type",
              "connectionId",
              "challengeId",
              "challenge",
              "expiresAt",
            ]) ||
            frame.type !== "challenge" ||
            !isUuidV4(frame.connectionId) ||
            !isUuidV4(frame.challengeId) ||
            typeof frame.challenge !== "string" ||
            typeof frame.expiresAt !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
              frame.expiresAt,
            )
          )
            throw new Error();
          const expiry = Date.parse(frame.expiresAt);
          if (
            !Number.isFinite(expiry) ||
            expiry <= Date.now() ||
            expiry > Date.now() + 10000
          )
            throw new Error();
          phase = "signing";
          const proof = await intelligenceProof(
            credential.key,
            frame.connectionId,
            frame.challengeId,
            frame.challenge,
          );
          if (this.disposed || this.socket !== socket) return;
          if (Date.now() >= expiry) throw new Error();
          phase = "ready";
          socket.send(
            JSON.stringify({
              type: "authenticate",
              credentialId: credential.credentialId,
              proof,
            }),
          );
          return;
        }
        if (phase === "ready") {
          if (!exact(frame, ["type"]) || frame.type !== "ready")
            throw new Error();
          phase = "active";
          clearTimeout(this.handshakeTimer);
          this.attempts = 0;
          this.setState("ready");
          return;
        }
        if (
          phase !== "active" ||
          frame.type !== "result" ||
          !isUuidV4(frame.id) ||
          typeof frame.ok !== "boolean" ||
          !exact(
            frame,
            frame.ok
              ? ["type", "id", "ok", "data"]
              : ["type", "id", "ok", "error"],
          )
        )
          throw new Error();
        if (
          !frame.ok &&
          (typeof frame.error !== "string" || !ERRORS.has(frame.error))
        )
          throw new Error();
        const pending = this.pending.get(frame.id);
        if (!pending) return;
        if (frame.ok && !validResult(pending.method, frame.data))
          throw new Error();
        this.pending.delete(frame.id);
        clearTimeout(pending.timer);
        if (frame.ok) pending.resolve(frame.data);
        else pending.reject(new Error(frame.error as string));
      } catch {
        socket.close(1002);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      clearTimeout(this.handshakeTimer);
      this.failed();
    };
  }
  private failed() {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error("UNAVAILABLE"));
    });
    this.pending.clear();
    if (this.disposed) return;
    this.setState("unavailable");
    if (this.attempts < 3) {
      const delay = 1000 * 2 ** this.attempts++;
      this.retryTimer = setTimeout(() => void this.open(), delay);
    }
  }
  request<M extends keyof Rpc>(
    method: M,
    params: Rpc[M][0],
  ): Promise<Rpc[M][1]> {
    if (this.state !== "ready" || !this.socket || this.pending.size >= 5)
      return Promise.reject(new Error("UNAVAILABLE"));
    const id = crypto.randomUUID();
    const frame = { type: "request", id, method, params };
    if (!validRequest(frame))
      return Promise.reject(new Error("INVALID_REQUEST"));
    const body = JSON.stringify(frame);
    if (new TextEncoder().encode(body).length > 65536)
      return Promise.reject(new Error("INVALID_REQUEST"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("UNAVAILABLE"));
      }, 10000);
      this.pending.set(id, {
        method,
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });
      try {
        this.socket!.send(body);
      } catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error("UNAVAILABLE"));
      }
    });
  }
  dispose() {
    this.disposed = true;
    ++this.generation;
    clearTimeout(this.retryTimer);
    clearTimeout(this.handshakeTimer);
    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000);
    this.failed();
    this.listeners.clear();
  }
}
