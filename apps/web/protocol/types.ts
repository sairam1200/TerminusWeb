import type {
  PROTOCOL_ERROR_CODES,
  PROTOCOL_MESSAGE_TYPES,
  PROTOCOL_VERSION,
} from "./constants";

export type ProtocolMessageType = (typeof PROTOCOL_MESSAGE_TYPES)[number];
export type ProtocolErrorCode = (typeof PROTOCOL_ERROR_CODES)[number];
export type ProtocolDirection = "client_to_agent" | "agent_to_client";
export type ProtocolConnectionState =
  | "NEW"
  | "NEGOTIATING"
  | "UNAUTHENTICATED"
  | "PAIRING"
  | "CHALLENGED"
  | "PROVING"
  | "READY"
  | "CLOSING"
  | "CLOSED";
export type ProtocolSessionState =
  | "NONE"
  | "OPENING"
  | "OPEN"
  | "DETACHING"
  | "DETACHED"
  | "REOPENING"
  | "REPLAYING"
  | "CLOSING"
  | "CLOSED";

export interface Dimensions {
  columns: number;
  rows: number;
}

export interface ProtocolFrame {
  version: typeof PROTOCOL_VERSION;
  type: ProtocolMessageType;
  connectionId: string;
  sequence: number;
  payload: Record<string, unknown>;
}

export interface ProtocolMachineInitialState {
  connectionState: ProtocolConnectionState;
  sessionState: ProtocolSessionState;
  nextSequence: Record<ProtocolDirection, number>;
  nextOutputOffset?: number;
  history?: {
    begun: boolean;
    cursor: number;
    endOffset: number;
  };
  sessionId?: string;
}

export interface ProtocolValidationContext {
  now?: string;
  challengeExpiresAt?: string;
  credentialSecret?: string;
  challenge?: string;
  reopenDecision?:
    | "allow"
    | "unknown_session"
    | "already_attached"
    | "wrong_credential"
    | "wrong_source_device"
    | "missing_source_device"
    | "closed_by_new_session";
}

export interface ProtocolMachineSnapshot {
  connectionState: ProtocolConnectionState;
  sessionState: ProtocolSessionState;
  nextSequence: Record<ProtocolDirection, number>;
  connectionId?: string;
  nextOutputOffset: number;
  history?: {
    begun: boolean;
    cursor: number;
    endOffset: number;
  };
  sessionId?: string;
}

export class ProtocolViolation extends Error {
  constructor(
    readonly code: ProtocolErrorCode,
    readonly closeCode: number,
  ) {
    super(code);
    this.name = "ProtocolViolation";
  }
}
