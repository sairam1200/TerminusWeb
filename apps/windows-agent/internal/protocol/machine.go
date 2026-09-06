package protocol

type Machine struct {
	Connection      ConnectionState
	Session         SessionState
	ConnectionID    string
	nextClient      uint64
	nextAgent       uint64
	clientExhausted bool
	agentExhausted  bool
	sessionID       string
	nextOutput      uint64
	historyBegun    bool
	historyCursor   uint64
	historyEnd      uint64
}

func NewMachine(connection ConnectionState, session SessionState, nextClient, nextAgent uint64) *Machine {
	return &Machine{Connection: connection, Session: session, nextClient: nextClient, nextAgent: nextAgent}
}

func (m *Machine) NextSequence(direction Direction) (uint64, bool) {
	if direction == ClientToAgent {
		return m.nextClient, !m.clientExhausted
	}
	return m.nextAgent, !m.agentExhausted
}

func (m *Machine) SetSession(state SessionState) { m.Session = state }
func (m *Machine) SetOutputOffset(offset uint64) { m.nextOutput = offset }
func (m *Machine) OutputOffset() uint64          { return m.nextOutput }

func (m *Machine) Apply(direction Direction, frame DecodedFrame) error {
	if m.ConnectionID == "" {
		m.ConnectionID = frame.ConnectionID
	}
	if frame.ConnectionID != m.ConnectionID {
		return protocolError(SchemaInvalid, 1002, nil)
	}
	expected := &m.nextAgent
	exhausted := &m.agentExhausted
	if direction == ClientToAgent {
		expected = &m.nextClient
		exhausted = &m.clientExhausted
	}
	if *exhausted {
		return protocolError(SequenceReplay, 1008, nil)
	}
	if frame.Sequence < *expected {
		return protocolError(SequenceReplay, 1008, nil)
	}
	if frame.Sequence > *expected {
		return protocolError(SequenceGap, 1008, nil)
	}
	if *expected == MaxSequence {
		*exhausted = true
	} else {
		*expected = *expected + 1
	}

	if frame.Type == "error" {
		if m.Connection == ConnectionClosed {
			return protocolError(InvalidState, 1008, nil)
		}
		m.Connection = ConnectionClosing
		return nil
	}
	if err := m.applySessionSemantics(frame); err != nil {
		return err
	}

	if next, ok := connectionTransition(m.Connection, direction, frame.Type); ok {
		m.Connection = next
		return nil
	}
	if next, ok := sessionTransition(m.Connection, m.Session, direction, frame.Type); ok {
		m.Session = next
		return nil
	}
	if hasTransitionForOtherDirection(m.Connection, m.Session, direction, frame.Type) {
		return protocolError(DirectionViolation, 1008, nil)
	}
	return protocolError(InvalidState, 1008, nil)
}

func (m *Machine) applySessionSemantics(frame DecodedFrame) error {
	id, hasID := frameSessionID(frame.Value)
	if hasID {
		if m.sessionID == "" {
			m.sessionID = id
		} else if m.sessionID != id {
			if frame.Type == "history_begin" || frame.Type == "history_chunk" || frame.Type == "history_end" || frame.Type == "terminal_output" {
				return protocolError(OutputOffsetInvalid, 1008, nil)
			}
			return protocolError(SchemaInvalid, 1002, nil)
		}
	}
	switch payload := frame.Value.(type) {
	case *HistoryBeginPayload:
		if m.historyBegun || payload.StartOffset > payload.EndOffset || payload.EndOffset-payload.StartOffset > MaxSessionHistory || (!payload.Truncated && payload.StartOffset != 0) || payload.EndOffset != m.nextOutput {
			return protocolError(OutputOffsetInvalid, 1008, nil)
		}
		m.historyBegun = true
		m.historyCursor = payload.StartOffset
		m.historyEnd = payload.EndOffset
	case *HistoryChunkPayload:
		data, _ := DecodeBase64(payload.Data, -1)
		length := uint64(len(data))
		if !m.historyBegun || payload.Offset != m.historyCursor || length > m.historyEnd-m.historyCursor || m.historyCursor > MaxSequence-length {
			return protocolError(OutputOffsetInvalid, 1008, nil)
		}
		m.historyCursor += length
	case *HistoryEndPayload:
		if !m.historyBegun || payload.EndOffset != m.historyEnd || m.historyCursor != m.historyEnd {
			return protocolError(OutputOffsetInvalid, 1008, nil)
		}
		m.historyBegun = false
	case *TerminalOutputPayload:
		data, _ := DecodeBase64(payload.Data, -1)
		length := uint64(len(data))
		if payload.Offset != m.nextOutput || m.nextOutput > MaxSequence-length {
			return protocolError(OutputOffsetInvalid, 1008, nil)
		}
		m.nextOutput += length
	}
	return nil
}

func frameSessionID(value any) (string, bool) {
	switch payload := value.(type) {
	case *SessionIDPayload:
		return payload.SessionID, true
	case *ReopenSessionPayload:
		return payload.SessionID, true
	case *TerminalPayload:
		return payload.SessionID, true
	case *TerminalOutputPayload:
		return payload.SessionID, true
	case *HistoryBeginPayload:
		return payload.SessionID, true
	case *HistoryChunkPayload:
		return payload.SessionID, true
	case *HistoryEndPayload:
		return payload.SessionID, true
	case *ResizePayload:
		return payload.SessionID, true
	case *CloseSessionPayload:
		return payload.SessionID, true
	case *SessionClosedPayload:
		return payload.SessionID, true
	default:
		return "", false
	}
}

func connectionTransition(state ConnectionState, direction Direction, message string) (ConnectionState, bool) {
	type key struct {
		state     ConnectionState
		direction Direction
		message   string
	}
	transitions := map[key]ConnectionState{
		{ConnectionNew, ClientToAgent, "hello"}:                       ConnectionNegotiating,
		{ConnectionNegotiating, AgentToClient, "hello_ack"}:           ConnectionUnauthenticated,
		{ConnectionUnauthenticated, ClientToAgent, "pairing_request"}: ConnectionPairing,
		{ConnectionPairing, AgentToClient, "pairing_result"}:          ConnectionUnauthenticated,
		{ConnectionUnauthenticated, AgentToClient, "auth_challenge"}:  ConnectionChallenged,
		{ConnectionChallenged, ClientToAgent, "auth_response"}:        ConnectionProving,
		{ConnectionProving, AgentToClient, "auth_result"}:             ConnectionReady,
		{ConnectionReady, ClientToAgent, "heartbeat"}:                 ConnectionReady,
		{ConnectionReady, AgentToClient, "heartbeat"}:                 ConnectionReady,
	}
	next, ok := transitions[key{state, direction, message}]
	return next, ok
}

func sessionTransition(connection ConnectionState, state SessionState, direction Direction, message string) (SessionState, bool) {
	if connection != ConnectionReady {
		return "", false
	}
	type key struct {
		state     SessionState
		direction Direction
		message   string
	}
	transitions := map[key]SessionState{
		{SessionNone, ClientToAgent, "open_session"}:          SessionOpening,
		{SessionOpening, AgentToClient, "session_opened"}:     SessionOpen,
		{SessionNone, ClientToAgent, "reopen_session"}:        SessionReopening,
		{SessionReopening, AgentToClient, "session_reopened"}: SessionReplaying,
		{SessionReplaying, AgentToClient, "history_begin"}:    SessionReplaying,
		{SessionReplaying, AgentToClient, "history_chunk"}:    SessionReplaying,
		{SessionReplaying, AgentToClient, "history_end"}:      SessionOpen,
		{SessionOpen, ClientToAgent, "terminal_input"}:        SessionOpen,
		{SessionOpen, AgentToClient, "terminal_output"}:       SessionOpen,
		{SessionOpen, ClientToAgent, "resize"}:                SessionOpen,
		{SessionOpen, ClientToAgent, "detach"}:                SessionDetaching,
		{SessionDetaching, AgentToClient, "session_detached"}: SessionDetached,
		{SessionOpen, ClientToAgent, "close_session"}:         SessionClosing,
		{SessionClosing, AgentToClient, "session_closed"}:     SessionClosed,
		{SessionOpen, AgentToClient, "session_closed"}:        SessionClosed,
	}
	next, ok := transitions[key{state, direction, message}]
	return next, ok
}

func hasTransitionForOtherDirection(connection ConnectionState, session SessionState, direction Direction, message string) bool {
	other := ClientToAgent
	if direction == ClientToAgent {
		other = AgentToClient
	}
	if _, ok := connectionTransition(connection, other, message); ok {
		return true
	}
	_, ok := sessionTransition(connection, session, other, message)
	return ok
}
