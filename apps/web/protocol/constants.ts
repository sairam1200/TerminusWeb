export const PROTOCOL_SOURCE_COMMIT =
  "910b69e24f464bb3e89152f3e5881beb9b706b76";
export const PROTOCOL_VERSION = "0.1" as const;
export const PROTOCOL_SUBPROTOCOL = "terminus.v0_1" as const;
export const MAX_FRAME_BYTES = 65_536;
export const MAX_OUTBOUND_BUFFERED_BYTES = MAX_FRAME_BYTES;
export const MAX_TERMINAL_INPUT_BYTES = 16_384;
export const MAX_TERMINAL_OUTPUT_BYTES = 32_768;
export const MAX_CREDENTIAL_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_LIVENESS_MS = 45_000;
export const MAX_SAFE_SEQUENCE = Number.MAX_SAFE_INTEGER;

export const PROTOCOL_ERROR_CODES = [
  "INVALID_JSON",
  "SCHEMA_INVALID",
  "UNSUPPORTED_VERSION",
  "UNKNOWN_TYPE",
  "FRAME_TOO_LARGE",
  "PAYLOAD_TOO_LARGE",
  "SEQUENCE_REPLAY",
  "SEQUENCE_GAP",
  "INVALID_STATE",
  "DIRECTION_VIOLATION",
  "ORIGIN_REJECTED",
  "PAIRING_FAILED",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_EXPIRED",
  "RESUME_REJECTED",
  "HELLO_TIMEOUT",
  "HEARTBEAT_TIMEOUT",
  "SESSION_OPEN_FAILED",
  "BACKPRESSURE_LIMIT",
] as const;

export const PROTOCOL_MESSAGE_TYPES = [
  "hello",
  "hello_ack",
  "pairing_request",
  "pairing_result",
  "auth_challenge",
  "auth_response",
  "auth_result",
  "open_session",
  "session_opened",
  "terminal_input",
  "terminal_output",
  "resize",
  "heartbeat",
  "detach",
  "session_detached",
  "resume_session",
  "session_resumed",
  "close_session",
  "session_closed",
  "error",
] as const;
