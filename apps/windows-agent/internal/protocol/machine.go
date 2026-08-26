package protocol

type Machine struct {
	Connection      ConnectionState
	Session         SessionState
	ConnectionID    string
	nextClient      uint64
	nextAgent       uint64
	clientExhausted bool
	agentExhausted  bool
}

func NewMachine(connection ConnectionState, session SessionState, nextClient, nextAgent uint64) *Machine {
	return &Machine{Connection: connection, Session: session, nextClient: nextClient, nextAgent: nextAgent}
}

func (m *Machine) NextSequence(direction Direction) uint64 {
	if direction == ClientToAgent {
		return m.nextClient
	}
	return m.nextAgent
}

func (m *Machine) SetSession(state SessionState) { m.Session = state }

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
		return protocolError(SequenceGap, 1008, nil)
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
		{SessionOpen, ClientToAgent, "terminal_input"}:        SessionOpen,
		{SessionOpen, AgentToClient, "terminal_output"}:       SessionOpen,
		{SessionOpen, ClientToAgent, "resize"}:                SessionOpen,
		{SessionOpen, ClientToAgent, "detach"}:                SessionDetaching,
		{SessionDetaching, AgentToClient, "session_detached"}: SessionDetached,
		{SessionDetached, ClientToAgent, "resume_session"}:    SessionResuming,
		{SessionResuming, AgentToClient, "session_resumed"}:   SessionOpen,
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
