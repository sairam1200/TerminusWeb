import {
  MAX_FRAME_BYTES,
  MAX_SAFE_SEQUENCE,
  MAX_TERMINAL_INPUT_BYTES,
  MAX_TERMINAL_OUTPUT_BYTES,
  PROTOCOL_ERROR_CODES,
  PROTOCOL_MESSAGE_TYPES,
  PROTOCOL_VERSION,
} from "./constants";
import type {
  Dimensions,
  ProtocolErrorCode,
  ProtocolFrame,
  ProtocolMessageType,
} from "./types";
import { ProtocolViolation } from "./types";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MESSAGE_TYPES = new Set<string>(PROTOCOL_MESSAGE_TYPES);
const ERROR_CODES = new Set<string>(PROTOCOL_ERROR_CODES);

const requiredPayloadKeys: Record<ProtocolMessageType, readonly string[]> = {
  hello: ["clientInstanceId", "supportedVersions"],
  hello_ack: ["selectedVersion", "agentId"],
  pairing_request: ["pairingCode"],
  pairing_result: ["credentialId", "credentialSecret", "credentialExpiresAt"],
  auth_challenge: ["challengeId", "challenge", "expiresAt"],
  auth_response: ["challengeId", "credentialId", "proof"],
  auth_result: ["authenticated", "authorizationExpiresAt"],
  open_session: ["shell", "dimensions"],
  session_opened: ["sessionId"],
  terminal_input: ["sessionId", "data"],
  terminal_output: ["sessionId", "data"],
  resize: ["sessionId", "dimensions"],
  heartbeat: ["kind", "nonce"],
  detach: ["sessionId"],
  session_detached: ["sessionId", "resumeGrant", "expiresAt"],
  resume_session: ["sessionId", "resumeGrant", "dimensions"],
  session_resumed: ["sessionId"],
  close_session: ["sessionId", "reason"],
  session_closed: ["sessionId", "reason"],
  error: ["code", "fatal"],
};

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(
  value: unknown,
  expectedBytes?: number,
): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== "string" ||
    !BASE64URL.test(value) ||
    value.includes("=")
  ) {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }

  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
  } catch {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (
    bytes.length === 0 ||
    (expectedBytes !== undefined && bytes.length !== expectedBytes) ||
    encodeBase64Url(bytes) !== value
  ) {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }
  return bytes;
}

export function parseProtocolFrame(raw: string): ProtocolFrame {
  if (new TextEncoder().encode(raw).byteLength > MAX_FRAME_BYTES) {
    throw new ProtocolViolation("FRAME_TOO_LARGE", 1009);
  }

  assertJsonWithoutDuplicateKeys(raw);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ProtocolViolation("INVALID_JSON", 1007);
  }
  return validateProtocolFrame(value);
}

export function validateProtocolFrame(value: unknown): ProtocolFrame {
  if (!isRecord(value)) throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  assertExactKeys(value, [
    "version",
    "type",
    "connectionId",
    "sequence",
    "payload",
  ]);

  if (value.version !== PROTOCOL_VERSION) {
    throw new ProtocolViolation("UNSUPPORTED_VERSION", 1002);
  }
  if (typeof value.type !== "string" || !MESSAGE_TYPES.has(value.type)) {
    throw new ProtocolViolation("UNKNOWN_TYPE", 1002);
  }
  if (!isUuidV4(value.connectionId)) {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }
  if (
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 0 ||
    (value.sequence as number) > MAX_SAFE_SEQUENCE
  ) {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }
  if (!isRecord(value.payload)) {
    throw new ProtocolViolation("SCHEMA_INVALID", 1002);
  }

  const type = value.type as ProtocolMessageType;
  validatePayload(type, value.payload);
  return value as unknown as ProtocolFrame;
}

function validatePayload(
  type: ProtocolMessageType,
  payload: Record<string, unknown>,
): void {
  const optional = type === "hello" ? ["credentialId"] : [];
  assertExactKeys(payload, requiredPayloadKeys[type], optional);

  switch (type) {
    case "hello": {
      assertUuid(payload.clientInstanceId);
      if (payload.credentialId !== undefined) assertUuid(payload.credentialId);
      if (
        !Array.isArray(payload.supportedVersions) ||
        payload.supportedVersions.length < 1 ||
        payload.supportedVersions.length > 8 ||
        new Set(payload.supportedVersions).size !==
          payload.supportedVersions.length ||
        !payload.supportedVersions.every(
          (version) =>
            typeof version === "string" && /^\d+\.\d+$/u.test(version),
        )
      ) {
        schemaInvalid();
      }
      break;
    }
    case "hello_ack":
      if (payload.selectedVersion !== PROTOCOL_VERSION) {
        throw new ProtocolViolation("UNSUPPORTED_VERSION", 1002);
      }
      assertUuid(payload.agentId);
      break;
    case "pairing_request":
      decodeBase64Url(payload.pairingCode, 16);
      break;
    case "pairing_result":
      assertUuid(payload.credentialId);
      decodeBase64Url(payload.credentialSecret, 32);
      assertTimestamp(payload.credentialExpiresAt);
      break;
    case "auth_challenge":
      assertUuid(payload.challengeId);
      decodeBase64Url(payload.challenge, 32);
      assertTimestamp(payload.expiresAt);
      break;
    case "auth_response":
      assertUuid(payload.challengeId);
      assertUuid(payload.credentialId);
      decodeBase64Url(payload.proof, 32);
      break;
    case "auth_result":
      if (payload.authenticated !== true) schemaInvalid();
      assertTimestamp(payload.authorizationExpiresAt);
      break;
    case "open_session":
      if (payload.shell !== "powershell") schemaInvalid();
      assertDimensions(payload.dimensions);
      break;
    case "session_opened":
    case "session_resumed":
    case "detach":
      assertUuid(payload.sessionId);
      break;
    case "terminal_input":
    case "terminal_output": {
      assertUuid(payload.sessionId);
      const decoded = decodeBase64Url(payload.data);
      const maximum =
        type === "terminal_input"
          ? MAX_TERMINAL_INPUT_BYTES
          : MAX_TERMINAL_OUTPUT_BYTES;
      if (decoded.byteLength > maximum) {
        throw new ProtocolViolation("PAYLOAD_TOO_LARGE", 1009);
      }
      break;
    }
    case "resize":
      assertUuid(payload.sessionId);
      assertDimensions(payload.dimensions);
      break;
    case "heartbeat":
      if (payload.kind !== "ping" && payload.kind !== "pong") schemaInvalid();
      decodeBase64Url(payload.nonce, 16);
      break;
    case "session_detached":
      assertUuid(payload.sessionId);
      decodeBase64Url(payload.resumeGrant, 32);
      assertTimestamp(payload.expiresAt);
      break;
    case "resume_session":
      assertUuid(payload.sessionId);
      decodeBase64Url(payload.resumeGrant, 32);
      assertDimensions(payload.dimensions);
      break;
    case "close_session":
      assertUuid(payload.sessionId);
      if (payload.reason !== "user_request") schemaInvalid();
      break;
    case "session_closed":
      assertUuid(payload.sessionId);
      if (
        ![
          "user_request",
          "idle_timeout",
          "agent_shutdown",
          "process_exit",
          "protocol_error",
          "backpressure_limit",
        ].includes(String(payload.reason))
      ) {
        schemaInvalid();
      }
      break;
    case "error":
      if (
        typeof payload.code !== "string" ||
        !ERROR_CODES.has(payload.code) ||
        payload.fatal !== true
      ) {
        schemaInvalid();
      }
      break;
  }
}

export function assertDimensions(value: unknown): asserts value is Dimensions {
  if (!isRecord(value)) schemaInvalid();
  assertExactKeys(value, ["columns", "rows"]);
  if (
    !Number.isInteger(value.columns) ||
    !Number.isInteger(value.rows) ||
    (value.columns as number) < 1 ||
    (value.columns as number) > 1000 ||
    (value.rows as number) < 1 ||
    (value.rows as number) > 1000
  ) {
    schemaInvalid();
  }
}

export function assertTimestamp(value: unknown): asserts value is string {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) schemaInvalid();
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value)
    schemaInvalid();
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4.test(value);
}

export function isSessionId(value: unknown): value is string {
  return isUuidV4(value);
}

function assertUuid(value: unknown): asserts value is string {
  if (!isUuidV4(value)) schemaInvalid();
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const keys = Object.keys(value);
  if (
    !required.every((key) => Object.hasOwn(value, key)) ||
    keys.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    schemaInvalid();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaInvalid(): never {
  throw new ProtocolViolation("SCHEMA_INVALID", 1002);
}

function assertJsonWithoutDuplicateKeys(raw: string): void {
  let index = 0;
  const whitespace = /\s/u;

  const skipWhitespace = () => {
    while (index < raw.length && whitespace.test(raw[index] ?? "")) index += 1;
  };

  const parseString = (): string => {
    if (raw[index] !== '"') invalidJson();
    const start = index;
    index += 1;
    while (index < raw.length) {
      const character = raw[index];
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') {
        index += 1;
        try {
          return JSON.parse(raw.slice(start, index)) as string;
        } catch {
          invalidJson();
        }
      }
      if (character !== undefined && character.charCodeAt(0) < 0x20)
        invalidJson();
      index += 1;
    }
    return invalidJson();
  };

  const parseValue = (): void => {
    skipWhitespace();
    const character = raw[index];
    if (character === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (raw[index] === "}") {
        index += 1;
        return;
      }
      while (index < raw.length) {
        const key = parseString();
        if (keys.has(key)) invalidJson();
        keys.add(key);
        skipWhitespace();
        if (raw[index] !== ":") invalidJson();
        index += 1;
        parseValue();
        skipWhitespace();
        if (raw[index] === "}") {
          index += 1;
          return;
        }
        if (raw[index] !== ",") invalidJson();
        index += 1;
        skipWhitespace();
      }
      invalidJson();
    }
    if (character === "[") {
      index += 1;
      skipWhitespace();
      if (raw[index] === "]") {
        index += 1;
        return;
      }
      while (index < raw.length) {
        parseValue();
        skipWhitespace();
        if (raw[index] === "]") {
          index += 1;
          return;
        }
        if (raw[index] !== ",") invalidJson();
        index += 1;
      }
      invalidJson();
    }
    if (character === '"') {
      parseString();
      return;
    }
    const remaining = raw.slice(index);
    const literal = /^(true|false|null)/u.exec(remaining)?.[0];
    if (literal !== undefined) {
      index += literal.length;
      return;
    }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(
      remaining,
    )?.[0];
    if (number !== undefined) {
      index += number.length;
      return;
    }
    invalidJson();
  };

  try {
    parseValue();
    skipWhitespace();
    if (index !== raw.length) invalidJson();
  } catch (error) {
    if (error instanceof ProtocolViolation) throw error;
    invalidJson();
  }
}

function invalidJson(): never {
  throw new ProtocolViolation("INVALID_JSON", 1007);
}

export function protocolErrorCode(
  value: unknown,
): ProtocolErrorCode | undefined {
  return typeof value === "string" && ERROR_CODES.has(value)
    ? (value as ProtocolErrorCode)
    : undefined;
}
