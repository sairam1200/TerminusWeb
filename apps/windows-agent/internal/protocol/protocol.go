package protocol

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"time"
	"unicode/utf8"
)

const (
	Version                  = "0.1"
	Subprotocol              = "terminus.v0_1"
	MaxWireBytes             = 65_536
	MaxTerminalInput         = 16_384
	MaxTerminalOutput        = 32_768
	MaxSequence       uint64 = 9_007_199_254_740_991
)

type Direction string

const (
	ClientToAgent Direction = "client_to_agent"
	AgentToClient Direction = "agent_to_client"
)

type ConnectionState string

const (
	ConnectionNew             ConnectionState = "NEW"
	ConnectionNegotiating     ConnectionState = "NEGOTIATING"
	ConnectionUnauthenticated ConnectionState = "UNAUTHENTICATED"
	ConnectionPairing         ConnectionState = "PAIRING"
	ConnectionChallenged      ConnectionState = "CHALLENGED"
	ConnectionProving         ConnectionState = "PROVING"
	ConnectionReady           ConnectionState = "READY"
	ConnectionClosing         ConnectionState = "CLOSING"
	ConnectionClosed          ConnectionState = "CLOSED"
)

type SessionState string

const (
	SessionNone      SessionState = "NONE"
	SessionOpening   SessionState = "OPENING"
	SessionOpen      SessionState = "OPEN"
	SessionDetaching SessionState = "DETACHING"
	SessionDetached  SessionState = "DETACHED"
	SessionResuming  SessionState = "RESUMING"
	SessionClosing   SessionState = "CLOSING"
	SessionClosed    SessionState = "CLOSED"
)

type ErrorCode string

const (
	InvalidJSON          ErrorCode = "INVALID_JSON"
	SchemaInvalid        ErrorCode = "SCHEMA_INVALID"
	UnsupportedVersion   ErrorCode = "UNSUPPORTED_VERSION"
	UnknownType          ErrorCode = "UNKNOWN_TYPE"
	FrameTooLarge        ErrorCode = "FRAME_TOO_LARGE"
	PayloadTooLarge      ErrorCode = "PAYLOAD_TOO_LARGE"
	SequenceReplay       ErrorCode = "SEQUENCE_REPLAY"
	SequenceGap          ErrorCode = "SEQUENCE_GAP"
	InvalidState         ErrorCode = "INVALID_STATE"
	DirectionViolation   ErrorCode = "DIRECTION_VIOLATION"
	OriginRejected       ErrorCode = "ORIGIN_REJECTED"
	PairingFailed        ErrorCode = "PAIRING_FAILED"
	AuthenticationFailed ErrorCode = "AUTHENTICATION_FAILED"
	AuthorizationExpired ErrorCode = "AUTHORIZATION_EXPIRED"
	ResumeRejected       ErrorCode = "RESUME_REJECTED"
	HelloTimeout         ErrorCode = "HELLO_TIMEOUT"
	HeartbeatTimeout     ErrorCode = "HEARTBEAT_TIMEOUT"
	SessionOpenFailed    ErrorCode = "SESSION_OPEN_FAILED"
	BackpressureLimit    ErrorCode = "BACKPRESSURE_LIMIT"
)

type ProtocolError struct {
	Code      ErrorCode
	CloseCode int
	Cause     error
}

func (e *ProtocolError) Error() string {
	if e.Cause != nil {
		return fmt.Sprintf("protocol %s: %v", e.Code, e.Cause)
	}
	return fmt.Sprintf("protocol %s", e.Code)
}

func (e *ProtocolError) Unwrap() error { return e.Cause }

func NewError(code ErrorCode, closeCode int, cause error) error {
	return protocolError(code, closeCode, cause)
}

func ErrorDetails(err error) (ErrorCode, int, bool) {
	var protocolErr *ProtocolError
	if !errors.As(err, &protocolErr) {
		return "", 0, false
	}
	return protocolErr.Code, protocolErr.CloseCode, true
}

type Frame struct {
	Version      string          `json:"version"`
	Type         string          `json:"type"`
	ConnectionID string          `json:"connectionId"`
	Sequence     uint64          `json:"sequence"`
	Payload      json.RawMessage `json:"payload"`
}

type DecodedFrame struct {
	Frame
	Value any
}

type HelloPayload struct {
	ClientInstanceID  string   `json:"clientInstanceId"`
	CredentialID      string   `json:"credentialId,omitempty"`
	SupportedVersions []string `json:"supportedVersions"`
}

type HelloAckPayload struct {
	SelectedVersion string `json:"selectedVersion"`
	AgentID         string `json:"agentId"`
}

type PairingRequestPayload struct {
	PairingCode string `json:"pairingCode"`
}

type PairingResultPayload struct {
	CredentialID        string `json:"credentialId"`
	CredentialSecret    string `json:"credentialSecret"`
	CredentialExpiresAt string `json:"credentialExpiresAt"`
}

type AuthChallengePayload struct {
	ChallengeID string `json:"challengeId"`
	Challenge   string `json:"challenge"`
	ExpiresAt   string `json:"expiresAt"`
}

type AuthResponsePayload struct {
	ChallengeID  string `json:"challengeId"`
	CredentialID string `json:"credentialId"`
	Proof        string `json:"proof"`
}

type AuthResultPayload struct {
	Authenticated          bool   `json:"authenticated"`
	AuthorizationExpiresAt string `json:"authorizationExpiresAt"`
}

type Dimensions struct {
	Columns uint16 `json:"columns"`
	Rows    uint16 `json:"rows"`
}

type OpenSessionPayload struct {
	Shell      string     `json:"shell"`
	Dimensions Dimensions `json:"dimensions"`
}

type SessionIDPayload struct {
	SessionID string `json:"sessionId"`
}

type TerminalPayload struct {
	SessionID string `json:"sessionId"`
	Data      string `json:"data"`
}

type ResizePayload struct {
	SessionID  string     `json:"sessionId"`
	Dimensions Dimensions `json:"dimensions"`
}

type HeartbeatPayload struct {
	Kind  string `json:"kind"`
	Nonce string `json:"nonce"`
}

type SessionDetachedPayload struct {
	SessionID   string `json:"sessionId"`
	ResumeGrant string `json:"resumeGrant"`
	ExpiresAt   string `json:"expiresAt"`
}

type ResumeSessionPayload struct {
	SessionID   string     `json:"sessionId"`
	ResumeGrant string     `json:"resumeGrant"`
	Dimensions  Dimensions `json:"dimensions"`
}

type CloseSessionPayload struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

type SessionClosedPayload struct {
	SessionID string `json:"sessionId"`
	Reason    string `json:"reason"`
}

type ErrorPayload struct {
	Code  ErrorCode `json:"code"`
	Fatal bool      `json:"fatal"`
}

var (
	uuidV4Pattern    = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	timestampPattern = regexp.MustCompile(`^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$`)
	typeSet          = map[string]struct{}{
		"hello": {}, "hello_ack": {}, "pairing_request": {}, "pairing_result": {},
		"auth_challenge": {}, "auth_response": {}, "auth_result": {}, "open_session": {},
		"session_opened": {}, "terminal_input": {}, "terminal_output": {}, "resize": {},
		"heartbeat": {}, "detach": {}, "session_detached": {}, "resume_session": {},
		"session_resumed": {}, "close_session": {}, "session_closed": {}, "error": {},
	}
	errorCodeSet = map[ErrorCode]struct{}{
		InvalidJSON: {}, SchemaInvalid: {}, UnsupportedVersion: {}, UnknownType: {},
		FrameTooLarge: {}, PayloadTooLarge: {}, SequenceReplay: {}, SequenceGap: {},
		InvalidState: {}, DirectionViolation: {}, OriginRejected: {}, PairingFailed: {},
		AuthenticationFailed: {}, AuthorizationExpired: {}, ResumeRejected: {},
		HelloTimeout: {}, HeartbeatTimeout: {}, SessionOpenFailed: {}, BackpressureLimit: {},
	}
)

func Decode(data []byte) (DecodedFrame, error) {
	if len(data) > MaxWireBytes {
		return DecodedFrame{}, protocolError(FrameTooLarge, 1009, nil)
	}
	if !utf8.Valid(data) {
		return DecodedFrame{}, protocolError(InvalidJSON, 1007, errors.New("invalid UTF-8"))
	}
	if err := rejectDuplicateMembers(data); err != nil {
		return DecodedFrame{}, protocolError(InvalidJSON, 1007, err)
	}
	if !json.Valid(data) {
		return DecodedFrame{}, protocolError(InvalidJSON, 1007, errors.New("malformed JSON"))
	}

	var frame Frame
	if err := decodeExact(data, &frame); err != nil {
		return DecodedFrame{}, protocolError(SchemaInvalid, 1002, err)
	}
	if frame.Version != Version {
		return DecodedFrame{}, protocolError(UnsupportedVersion, 1002, nil)
	}
	if _, ok := typeSet[frame.Type]; !ok {
		return DecodedFrame{}, protocolError(UnknownType, 1002, nil)
	}
	if !ValidUUID(frame.ConnectionID) || frame.Sequence > MaxSequence || frame.Payload == nil {
		return DecodedFrame{}, protocolError(SchemaInvalid, 1002, nil)
	}
	value, err := decodePayload(frame.Type, frame.Payload)
	if err != nil {
		var pe *ProtocolError
		if errors.As(err, &pe) {
			return DecodedFrame{}, pe
		}
		return DecodedFrame{}, protocolError(SchemaInvalid, 1002, err)
	}
	return DecodedFrame{Frame: frame, Value: value}, nil
}

func NewFrame(messageType, connectionID string, sequence uint64, payload any) (Frame, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return Frame{}, err
	}
	encoded, err := json.Marshal(Frame{Version: Version, Type: messageType, ConnectionID: connectionID, Sequence: sequence, Payload: raw})
	if err != nil {
		return Frame{}, err
	}
	decoded, err := Decode(encoded)
	if err != nil {
		return Frame{}, err
	}
	return decoded.Frame, nil
}

func Marshal(frame Frame) ([]byte, error) {
	data, err := json.Marshal(frame)
	if err != nil {
		return nil, err
	}
	if len(data) > MaxWireBytes {
		return nil, protocolError(FrameTooLarge, 1009, nil)
	}
	return data, nil
}

func ValidUUID(value string) bool { return uuidV4Pattern.MatchString(value) }

func FormatTimestamp(value time.Time) string { return value.UTC().Format("2006-01-02T15:04:05.000Z") }

func DecodeBase64(value string, size int) ([]byte, bool) {
	if value == "" || bytes.ContainsRune([]byte(value), '=') {
		return nil, false
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil || (size >= 0 && len(decoded) != size) || base64.RawURLEncoding.EncodeToString(decoded) != value {
		return nil, false
	}
	return decoded, true
}

func EncodeBase64(value []byte) string { return base64.RawURLEncoding.EncodeToString(value) }

func decodePayload(messageType string, raw json.RawMessage) (any, error) {
	var target any
	switch messageType {
	case "hello":
		target = &HelloPayload{}
	case "hello_ack":
		target = &HelloAckPayload{}
	case "pairing_request":
		target = &PairingRequestPayload{}
	case "pairing_result":
		target = &PairingResultPayload{}
	case "auth_challenge":
		target = &AuthChallengePayload{}
	case "auth_response":
		target = &AuthResponsePayload{}
	case "auth_result":
		target = &AuthResultPayload{}
	case "open_session":
		target = &OpenSessionPayload{}
	case "session_opened", "session_resumed", "detach":
		target = &SessionIDPayload{}
	case "terminal_input", "terminal_output":
		target = &TerminalPayload{}
	case "resize":
		target = &ResizePayload{}
	case "heartbeat":
		target = &HeartbeatPayload{}
	case "session_detached":
		target = &SessionDetachedPayload{}
	case "resume_session":
		target = &ResumeSessionPayload{}
	case "close_session":
		target = &CloseSessionPayload{}
	case "session_closed":
		target = &SessionClosedPayload{}
	case "error":
		target = &ErrorPayload{}
	}
	if err := decodeExact(raw, target); err != nil {
		return nil, err
	}
	if err := validatePayload(messageType, target); err != nil {
		return nil, err
	}
	return target, nil
}

func validatePayload(messageType string, value any) error {
	invalid := func() error { return protocolError(SchemaInvalid, 1002, nil) }
	switch payload := value.(type) {
	case *HelloPayload:
		if !ValidUUID(payload.ClientInstanceID) || (payload.CredentialID != "" && !ValidUUID(payload.CredentialID)) || len(payload.SupportedVersions) < 1 || len(payload.SupportedVersions) > 8 {
			return invalid()
		}
		seen := map[string]struct{}{}
		for _, version := range payload.SupportedVersions {
			if !regexp.MustCompile(`^[0-9]+\.[0-9]+$`).MatchString(version) {
				return invalid()
			}
			if _, ok := seen[version]; ok {
				return invalid()
			}
			seen[version] = struct{}{}
		}
	case *HelloAckPayload:
		if payload.SelectedVersion != Version || !ValidUUID(payload.AgentID) {
			return invalid()
		}
	case *PairingRequestPayload:
		if _, ok := DecodeBase64(payload.PairingCode, 16); !ok {
			return invalid()
		}
	case *PairingResultPayload:
		if !ValidUUID(payload.CredentialID) || !fixedBase64(payload.CredentialSecret, 32) || !validTimestamp(payload.CredentialExpiresAt) {
			return invalid()
		}
	case *AuthChallengePayload:
		if !ValidUUID(payload.ChallengeID) || !fixedBase64(payload.Challenge, 32) || !validTimestamp(payload.ExpiresAt) {
			return invalid()
		}
	case *AuthResponsePayload:
		if !ValidUUID(payload.ChallengeID) || !ValidUUID(payload.CredentialID) || !fixedBase64(payload.Proof, 32) {
			return invalid()
		}
	case *AuthResultPayload:
		if !payload.Authenticated || !validTimestamp(payload.AuthorizationExpiresAt) {
			return invalid()
		}
	case *OpenSessionPayload:
		if payload.Shell != "powershell" || !validDimensions(payload.Dimensions) {
			return invalid()
		}
	case *SessionIDPayload:
		if !ValidUUID(payload.SessionID) {
			return invalid()
		}
	case *TerminalPayload:
		if !ValidUUID(payload.SessionID) {
			return invalid()
		}
		decoded, ok := DecodeBase64(payload.Data, -1)
		if !ok || len(decoded) == 0 {
			return invalid()
		}
		limit := MaxTerminalOutput
		if messageType == "terminal_input" {
			limit = MaxTerminalInput
		}
		if len(decoded) > limit {
			return protocolError(PayloadTooLarge, 1009, nil)
		}
	case *ResizePayload:
		if !ValidUUID(payload.SessionID) || !validDimensions(payload.Dimensions) {
			return invalid()
		}
	case *HeartbeatPayload:
		if (payload.Kind != "ping" && payload.Kind != "pong") || !fixedBase64(payload.Nonce, 16) {
			return invalid()
		}
	case *SessionDetachedPayload:
		if !ValidUUID(payload.SessionID) || !fixedBase64(payload.ResumeGrant, 32) || !validTimestamp(payload.ExpiresAt) {
			return invalid()
		}
	case *ResumeSessionPayload:
		if !ValidUUID(payload.SessionID) || !fixedBase64(payload.ResumeGrant, 32) || !validDimensions(payload.Dimensions) {
			return invalid()
		}
	case *CloseSessionPayload:
		if !ValidUUID(payload.SessionID) || payload.Reason != "user_request" {
			return invalid()
		}
	case *SessionClosedPayload:
		if !ValidUUID(payload.SessionID) || !contains([]string{"user_request", "idle_timeout", "agent_shutdown", "process_exit", "protocol_error", "backpressure_limit"}, payload.Reason) {
			return invalid()
		}
	case *ErrorPayload:
		if _, ok := errorCodeSet[payload.Code]; !ok || !payload.Fatal {
			return invalid()
		}
	default:
		return invalid()
	}
	return nil
}

func decodeExact(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON value")
	}
	return nil
}

func rejectDuplicateMembers(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delim, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		switch delim {
		case '{':
			seen := map[string]struct{}{}
			for decoder.More() {
				keyToken, err := decoder.Token()
				if err != nil {
					return err
				}
				key, ok := keyToken.(string)
				if !ok {
					return errors.New("non-string object member")
				}
				if _, exists := seen[key]; exists {
					return fmt.Errorf("duplicate object member %q", key)
				}
				seen[key] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
			return err
		case '[':
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
			_, err = decoder.Token()
			return err
		default:
			return errors.New("unexpected JSON delimiter")
		}
	}
	if err := walk(); err != nil {
		return err
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return errors.New("trailing JSON value")
	}
	return nil
}

func validDimensions(value Dimensions) bool {
	return value.Columns >= 1 && value.Columns <= 1000 && value.Rows >= 1 && value.Rows <= 1000
}
func fixedBase64(value string, size int) bool { _, ok := DecodeBase64(value, size); return ok }
func validTimestamp(value string) bool {
	if !timestampPattern.MatchString(value) {
		return false
	}
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	return err == nil && FormatTimestamp(parsed) == value
}
func contains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}
func protocolError(code ErrorCode, closeCode int, cause error) error {
	return &ProtocolError{Code: code, CloseCode: closeCode, Cause: cause}
}
