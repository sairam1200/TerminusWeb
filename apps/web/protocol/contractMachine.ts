import { computeAuthenticationProof, importCredentialKey } from "./auth";
import {
  decodeBase64Url,
  parseProtocolFrame,
  validateProtocolFrame,
} from "./codec";
import { MAX_SAFE_SEQUENCE, PROTOCOL_VERSION } from "./constants";
import type {
  ProtocolDirection,
  ProtocolFrame,
  ProtocolMachineInitialState,
  ProtocolMachineSnapshot,
  ProtocolValidationContext,
} from "./types";
import { ProtocolViolation } from "./types";

interface Transition {
  connection?: ProtocolMachineSnapshot["connectionState"];
  session?: ProtocolMachineSnapshot["sessionState"];
}

const connectionTransitions = new Map<string, Transition>([
  ["NEW|client_to_agent|hello", { connection: "NEGOTIATING" }],
  ["NEGOTIATING|agent_to_client|hello_ack", { connection: "UNAUTHENTICATED" }],
  [
    "UNAUTHENTICATED|client_to_agent|pairing_request",
    { connection: "PAIRING" },
  ],
  ["PAIRING|agent_to_client|pairing_result", { connection: "UNAUTHENTICATED" }],
  [
    "UNAUTHENTICATED|agent_to_client|auth_challenge",
    { connection: "CHALLENGED" },
  ],
  ["CHALLENGED|client_to_agent|auth_response", { connection: "PROVING" }],
  ["PROVING|agent_to_client|auth_result", { connection: "READY" }],
  ["READY|client_to_agent|heartbeat", { connection: "READY" }],
  ["READY|agent_to_client|heartbeat", { connection: "READY" }],
]);

const sessionTransitions = new Map<string, Transition>([
  ["READY|NONE|client_to_agent|open_session", { session: "OPENING" }],
  ["READY|OPENING|agent_to_client|session_opened", { session: "OPEN" }],
  ["READY|NONE|client_to_agent|reopen_session", { session: "REOPENING" }],
  [
    "READY|REOPENING|agent_to_client|session_reopened",
    { session: "REPLAYING" },
  ],
  ["READY|REPLAYING|agent_to_client|history_begin", { session: "REPLAYING" }],
  ["READY|REPLAYING|agent_to_client|history_chunk", { session: "REPLAYING" }],
  ["READY|REPLAYING|agent_to_client|history_end", { session: "OPEN" }],
  ["READY|OPEN|client_to_agent|terminal_input", { session: "OPEN" }],
  ["READY|OPEN|agent_to_client|terminal_output", { session: "OPEN" }],
  ["READY|OPEN|client_to_agent|resize", { session: "OPEN" }],
  ["READY|OPEN|client_to_agent|detach", { session: "DETACHING" }],
  ["READY|DETACHING|agent_to_client|session_detached", { session: "DETACHED" }],
  ["READY|OPEN|client_to_agent|close_session", { session: "CLOSING" }],
  ["READY|CLOSING|agent_to_client|session_closed", { session: "CLOSED" }],
  ["READY|OPEN|agent_to_client|session_closed", { session: "CLOSED" }],
]);

export class ProtocolContractMachine {
  private snapshot: ProtocolMachineSnapshot;
  private nextOutputOffsetKnown: boolean;

  constructor(
    initial: ProtocolMachineInitialState = {
      connectionState: "NEW",
      sessionState: "NONE",
      nextSequence: { client_to_agent: 0, agent_to_client: 0 },
    },
  ) {
    this.nextOutputOffsetKnown = initial.nextOutputOffset !== undefined;
    this.snapshot = {
      ...structuredClone(initial),
      nextOutputOffset: initial.nextOutputOffset ?? 0,
    };
  }

  getSnapshot(): ProtocolMachineSnapshot {
    return structuredClone(this.snapshot);
  }

  async apply(
    direction: ProtocolDirection,
    input: string | ProtocolFrame | unknown,
    context: ProtocolValidationContext = {},
  ): Promise<ProtocolFrame> {
    const frame =
      typeof input === "string"
        ? parseProtocolFrame(input)
        : validateProtocolFrame(input);

    if (this.snapshot.connectionId === undefined) {
      this.snapshot.connectionId = frame.connectionId;
    } else if (frame.connectionId !== this.snapshot.connectionId) {
      throw new ProtocolViolation("SCHEMA_INVALID", 1002);
    }

    if (
      frame.type === "hello" &&
      !(frame.payload.supportedVersions as unknown[]).includes(PROTOCOL_VERSION)
    ) {
      throw new ProtocolViolation("UNSUPPORTED_VERSION", 1002);
    }

    const expectedSequence = this.snapshot.nextSequence[direction];
    if (frame.sequence < expectedSequence) {
      throw new ProtocolViolation("SEQUENCE_REPLAY", 1008);
    }
    if (frame.sequence > expectedSequence) {
      throw new ProtocolViolation("SEQUENCE_GAP", 1008);
    }

    await this.validateContext(frame, context);
    const transition = this.findTransition(direction, frame.type);
    this.validateSessionData(frame);
    this.snapshot.nextSequence[direction] = nextSequence(expectedSequence);
    if (transition.connection !== undefined) {
      this.snapshot.connectionState = transition.connection;
    }
    if (transition.session !== undefined) {
      this.snapshot.sessionState = transition.session;
    }
    return frame;
  }

  private findTransition(
    direction: ProtocolDirection,
    type: string,
  ): Transition {
    if (type === "error" && this.snapshot.connectionState !== "CLOSED") {
      return { connection: "CLOSING" };
    }

    const connectionPrefix = `${this.snapshot.connectionState}|`;
    const connectionKey = `${connectionPrefix}${direction}|${type}`;
    const connectionTransition = connectionTransitions.get(connectionKey);
    if (connectionTransition !== undefined) return connectionTransition;

    const sessionPrefix = `${this.snapshot.connectionState}|${this.snapshot.sessionState}|`;
    const sessionKey = `${sessionPrefix}${direction}|${type}`;
    const sessionTransition = sessionTransitions.get(sessionKey);
    if (sessionTransition !== undefined) return sessionTransition;

    const oppositeDirection =
      direction === "client_to_agent" ? "agent_to_client" : "client_to_agent";
    if (
      connectionTransitions.has(
        `${connectionPrefix}${oppositeDirection}|${type}`,
      ) ||
      sessionTransitions.has(`${sessionPrefix}${oppositeDirection}|${type}`)
    ) {
      throw new ProtocolViolation("DIRECTION_VIOLATION", 1008);
    }
    throw new ProtocolViolation("INVALID_STATE", 1008);
  }

  private async validateContext(
    frame: ProtocolFrame,
    context: ProtocolValidationContext,
  ): Promise<void> {
    if (
      frame.type === "auth_response" &&
      context.challengeExpiresAt !== undefined &&
      context.now !== undefined &&
      new Date(context.now) >= new Date(context.challengeExpiresAt)
    ) {
      throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
    }

    if (
      frame.type === "auth_response" &&
      context.credentialSecret !== undefined &&
      context.challenge !== undefined
    ) {
      const key = await importCredentialKey(context.credentialSecret);
      const expected = await computeAuthenticationProof(
        key,
        frame.connectionId,
        String(frame.payload.challengeId),
        context.challenge,
      );
      if (expected !== frame.payload.proof) {
        throw new ProtocolViolation("AUTHENTICATION_FAILED", 1008);
      }
    }

    if (
      frame.type === "reopen_session" &&
      context.reopenDecision !== undefined &&
      context.reopenDecision !== "allow"
    ) {
      throw new ProtocolViolation("SESSION_REOPEN_REJECTED", 1008);
    }
  }

  private validateSessionData(frame: ProtocolFrame): void {
    const payloadSessionId =
      typeof frame.payload.sessionId === "string"
        ? frame.payload.sessionId
        : undefined;
    if (
      this.snapshot.sessionId !== undefined &&
      payloadSessionId !== undefined &&
      frame.type !== "reopen_session" &&
      payloadSessionId !== this.snapshot.sessionId
    ) {
      throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
    }

    switch (frame.type) {
      case "session_opened":
      case "session_reopened":
        this.snapshot.sessionId = payloadSessionId;
        if (frame.type === "session_opened") {
          this.snapshot.nextOutputOffset = 0;
          this.nextOutputOffsetKnown = true;
        }
        break;
      case "history_begin": {
        const start = Number(frame.payload.startOffset);
        const end = Number(frame.payload.endOffset);
        if (
          end < start ||
          end - start > 262_144 ||
          (frame.payload.truncated === false && start !== 0) ||
          (this.nextOutputOffsetKnown && end !== this.snapshot.nextOutputOffset)
        ) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.snapshot.history = {
          begun: true,
          cursor: start,
          endOffset: end,
        };
        this.snapshot.nextOutputOffset = end;
        this.nextOutputOffsetKnown = true;
        break;
      }
      case "history_chunk": {
        const history = this.snapshot.history;
        const offset = Number(frame.payload.offset);
        const length = decodeBase64Url(frame.payload.data).byteLength;
        if (
          history === undefined ||
          !history.begun ||
          offset !== history.cursor ||
          offset + length > history.endOffset ||
          offset + length > MAX_SAFE_SEQUENCE
        ) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        history.cursor += length;
        break;
      }
      case "history_end": {
        const history = this.snapshot.history;
        const end = Number(frame.payload.endOffset);
        if (
          history === undefined ||
          !history.begun ||
          history.cursor !== history.endOffset ||
          end !== history.endOffset
        ) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.snapshot.nextOutputOffset = end;
        this.snapshot.history = undefined;
        break;
      }
      case "terminal_output": {
        const offset = Number(frame.payload.offset);
        const length = decodeBase64Url(frame.payload.data).byteLength;
        if (
          offset !== this.snapshot.nextOutputOffset ||
          offset + length > MAX_SAFE_SEQUENCE
        ) {
          throw new ProtocolViolation("OUTPUT_OFFSET_INVALID", 1008);
        }
        this.snapshot.nextOutputOffset += length;
        break;
      }
    }
  }
}

function nextSequence(current: number): number {
  if (current >= MAX_SAFE_SEQUENCE) {
    throw new ProtocolViolation("SEQUENCE_GAP", 1008);
  }
  return current + 1;
}

export function evaluateHandshake(
  request: { scheme: unknown; origin?: unknown; subprotocol: unknown },
  allowedOrigins: readonly string[],
): {
  code: "ACCEPT" | "ORIGIN_REJECTED" | "UNSUPPORTED_VERSION";
  httpStatus: number;
} {
  if (request.subprotocol !== "terminus.v0_2") {
    return { code: "UNSUPPORTED_VERSION", httpStatus: 426 };
  }
  if (
    request.scheme !== "wss" ||
    typeof request.origin !== "string" ||
    !allowedOrigins.includes(request.origin)
  ) {
    return { code: "ORIGIN_REJECTED", httpStatus: 403 };
  }
  return { code: "ACCEPT", httpStatus: 101 };
}
