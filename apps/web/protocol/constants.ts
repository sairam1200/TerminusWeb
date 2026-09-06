export const PROTOCOL_SOURCE_COMMIT =
  "f9a70299974734c3eeb920697d2dfa4717148a9a";
export const PROTOCOL_VERSION = "0.2" as const;
export const PROTOCOL_SUBPROTOCOL = "terminus.v0_2" as const;
export const MAX_FRAME_BYTES = 65_536;
export const MAX_OUTBOUND_BUFFERED_BYTES = MAX_FRAME_BYTES;
export const MAX_TERMINAL_INPUT_BYTES = 16_384;
export const MAX_TERMINAL_OUTPUT_BYTES = 32_768;
export const MAX_CREDENTIAL_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const AUTH_CHALLENGE_LIFETIME_MS = 10_000;
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
  "OUTPUT_OFFSET_INVALID",
  "INVALID_STATE",
  "DIRECTION_VIOLATION",
  "ORIGIN_REJECTED",
  "PAIRING_FAILED",
  "AUTHENTICATION_FAILED",
  "AUTHORIZATION_EXPIRED",
  "SESSION_REOPEN_REJECTED",
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
  "reopen_session",
  "session_reopened",
  "history_begin",
  "history_chunk",
  "history_end",
  "terminal_input",
  "terminal_output",
  "resize",
  "heartbeat",
  "detach",
  "session_detached",
  "close_session",
  "session_closed",
  "error",
] as const;
