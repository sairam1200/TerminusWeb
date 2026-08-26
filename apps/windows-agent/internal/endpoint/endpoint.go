package endpoint

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

const (
	helloLimit       = 5 * time.Second
	heartbeatPeriod  = 15 * time.Second
	livenessLimit    = 45 * time.Second
	resumeLifetime   = 120 * time.Second
	maxPendingOutput = 65_536
	writeQueueSize   = 32
	writeLimit       = 5 * time.Second
)

type DeviceResolver func(*http.Request) (string, error)

type Event struct {
	Name         string
	Code         protocol.ErrorCode
	ConnectionID string
	SessionID    string
}

type Logger func(Event)

type Config struct {
	AllowedOrigin  string
	AgentID        string
	Terminal       terminal.Adapter
	Credentials    CredentialStore
	ApprovePairing ApprovePairing
	ResolveDevice  DeviceResolver
	Log            Logger
	Now            func() time.Time
}

type Endpoint struct {
	cfg           Config
	pairing       pairingManager
	limiter       *rateLimiter
	sessions      sessionRegistry
	upgrader      websocket.Upgrader
	mu            sync.Mutex
	connections   map[*connection]struct{}
	connectionIDs map[string]struct{}
	closed        bool
}

func New(config Config) (*Endpoint, error) {
	if err := validateOrigin(config.AllowedOrigin); err != nil {
		return nil, err
	}
	if !protocol.ValidUUID(config.AgentID) {
		return nil, errors.New("agent ID must be a lowercase UUIDv4")
	}
	if config.Terminal == nil || config.Credentials == nil || config.ApprovePairing == nil || config.ResolveDevice == nil {
		return nil, errors.New("terminal, credential store, local pairing approval, and device resolver are required")
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.Log == nil {
		config.Log = func(Event) {}
	}
	e := &Endpoint{cfg: config, limiter: newRateLimiter(), connections: make(map[*connection]struct{}), connectionIDs: make(map[string]struct{})}
	e.sessions.adapter = config.Terminal
	e.sessions.now = config.Now
	e.upgrader = websocket.Upgrader{
		Subprotocols: []string{protocol.Subprotocol},
		CheckOrigin:  func(r *http.Request) bool { return exactOrigin(r.Header.Values("Origin"), config.AllowedOrigin) },
	}
	return e, nil
}

func (e *Endpoint) IssuePairingCode() (string, time.Time, error) { return e.pairing.issue(e.cfg.Now()) }

func (e *Endpoint) Close() error {
	e.mu.Lock()
	e.closed = true
	connections := make([]*connection, 0, len(e.connections))
	for connection := range e.connections {
		connections = append(connections, connection)
	}
	e.mu.Unlock()
	for _, connection := range connections {
		connection.shutdown()
	}
	return e.sessions.close("agent_shutdown")
}

func (e *Endpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e.mu.Lock()
	closed := e.closed
	e.mu.Unlock()
	if closed {
		http.Error(w, "agent is shutting down", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path != "/terminal" || r.Method != http.MethodGet {
		http.NotFound(w, r)
		return
	}
	if r.TLS == nil {
		http.Error(w, "HTTPS required", http.StatusForbidden)
		return
	}
	if r.URL.RawQuery != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
		http.Error(w, "credentials are not accepted in request metadata", http.StatusBadRequest)
		return
	}
	if !exactOrigin(r.Header.Values("Origin"), e.cfg.AllowedOrigin) {
		http.Error(w, "origin rejected", http.StatusForbidden)
		return
	}
	if !exactSubprotocol(r.Header.Values("Sec-WebSocket-Protocol")) {
		w.Header().Set("Sec-WebSocket-Protocol", protocol.Subprotocol)
		http.Error(w, "required WebSocket subprotocol", http.StatusUpgradeRequired)
		return
	}
	device, err := e.cfg.ResolveDevice(r)
	if err != nil || strings.TrimSpace(device) == "" {
		http.Error(w, "private device identity required", http.StatusForbidden)
		return
	}
	if !e.limiter.allowed(device, e.cfg.Now()) {
		http.Error(w, "authentication cooldown", http.StatusTooManyRequests)
		return
	}
	ws, err := e.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	c := newConnection(e, ws, device, r.Header.Get("Origin"))
	if !e.register(c) {
		_ = ws.Close()
		return
	}
	c.run()
}

func (e *Endpoint) register(connection *connection) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.closed {
		return false
	}
	e.connections[connection] = struct{}{}
	return true
}

func (e *Endpoint) unregister(connection *connection) {
	e.mu.Lock()
	delete(e.connections, connection)
	e.mu.Unlock()
}

func (e *Endpoint) claimConnectionID(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if _, used := e.connectionIDs[id]; used {
		return false
	}
	e.connectionIDs[id] = struct{}{}
	return true
}

func (e *Endpoint) RevokeCredential(ctx context.Context, credentialID string) error {
	if !protocol.ValidUUID(credentialID) {
		return errors.New("credential ID must be a lowercase UUIDv4")
	}
	if err := e.cfg.Credentials.Delete(ctx, credentialID); err != nil {
		return err
	}
	_ = e.sessions.revokeCredential(credentialID)
	e.mu.Lock()
	connections := make([]*connection, 0, len(e.connections))
	for connection := range e.connections {
		connections = append(connections, connection)
	}
	e.mu.Unlock()
	for _, connection := range connections {
		if connection.credentialID() == credentialID {
			connection.fail(protocol.NewError(protocol.AuthenticationFailed, 1008, nil))
		}
	}
	return nil
}

func validateOrigin(value string) error {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.RawPath != "" {
		return errors.New("allowed origin must be one exact serialized HTTPS origin")
	}
	if strings.Contains(parsed.Host, "*") || value != "https://"+parsed.Host {
		return errors.New("allowed origin must be exact and must not contain wildcards")
	}
	return nil
}

func exactSubprotocol(values []string) bool {
	if len(values) != 1 {
		return false
	}
	parts := strings.Split(values[0], ",")
	return len(parts) == 1 && strings.TrimSpace(parts[0]) == protocol.Subprotocol
}

func exactOrigin(values []string, allowed string) bool {
	return len(values) == 1 && values[0] == allowed
}

type outbound struct {
	frame  protocol.Frame
	result chan error
}

type connection struct {
	endpoint         *Endpoint
	ws               *websocket.Conn
	device           string
	origin           string
	id               string
	clientInstanceID string
	credential       Credential
	authorizedUntil  time.Time
	challenge        *challenge
	authMu           sync.RWMutex
	machine          *protocol.Machine
	protocolMu       sync.Mutex
	writes           chan outbound
	done             chan struct{}
	closeOnce        sync.Once
	failOnce         sync.Once
	lastSeenMu       sync.Mutex
	lastSeen         time.Time
	attemptMu        sync.Mutex
	attemptReserved  bool
}

func newConnection(endpoint *Endpoint, ws *websocket.Conn, device, origin string) *connection {
	return &connection{endpoint: endpoint, ws: ws, device: device, origin: origin,
		machine: protocol.NewMachine(protocol.ConnectionNew, protocol.SessionNone, 0, 0),
		writes:  make(chan outbound, writeQueueSize), done: make(chan struct{}), lastSeen: endpoint.cfg.Now()}
}

func (c *connection) run() {
	defer c.shutdown()
	c.ws.SetReadLimit(protocol.MaxWireBytes)
	c.ws.SetReadDeadline(c.endpoint.cfg.Now().Add(helloLimit))
	go c.writeLoop()
	go c.heartbeatLoop()
	for {
		kind, data, err := c.ws.ReadMessage()
		if err != nil {
			if errors.Is(err, websocket.ErrReadLimit) {
				c.fail(protocol.NewError(protocol.FrameTooLarge, 1009, nil))
				return
			}
			var timeout interface{ Timeout() bool }
			if errors.As(err, &timeout) && timeout.Timeout() {
				if c.id == "" {
					c.fail(protocol.NewError(protocol.HelloTimeout, 1008, nil))
				} else if c.connectionState() == protocol.ConnectionChallenged {
					c.fail(protocol.NewError(protocol.AuthenticationFailed, 1008, nil))
				}
			}
			return
		}
		if kind != websocket.TextMessage {
			c.fail(protocol.NewError(protocol.InvalidJSON, 1003, errors.New("binary frame")))
			return
		}
		decoded, err := protocol.Decode(data)
		if err != nil {
			c.fail(err)
			return
		}
		if err := c.applyIncoming(decoded); err != nil {
			c.fail(err)
			return
		}
		c.markSeen()
		if err := c.handle(decoded); err != nil {
			c.fail(err)
			return
		}
	}
}

func (c *connection) handle(frame protocol.DecodedFrame) error {
	now := c.endpoint.cfg.Now()
	if deadline := c.authorizationDeadline(); !deadline.IsZero() && !now.Before(deadline) {
		return protocol.NewError(protocol.AuthorizationExpired, 1008, nil)
	}
	switch payload := frame.Value.(type) {
	case *protocol.HelloPayload:
		c.clientInstanceID = payload.ClientInstanceID
		if !containsString(payload.SupportedVersions, protocol.Version) {
			return protocol.NewError(protocol.UnsupportedVersion, 1002, nil)
		}
		if err := c.send("hello_ack", protocol.HelloAckPayload{SelectedVersion: protocol.Version, AgentID: c.endpoint.cfg.AgentID}); err != nil {
			return err
		}
		c.ws.SetReadDeadline(time.Time{})
		if payload.CredentialID != "" {
			if !c.beginAttempt(now) {
				return protocol.NewError(protocol.AuthenticationFailed, 1008, nil)
			}
			credential, err := c.endpoint.cfg.Credentials.Get(context.Background(), payload.CredentialID)
			if err != nil || !now.Before(credential.ExpiresAt) {
				c.finishAttempt(false)
				return protocol.NewError(protocol.AuthenticationFailed, 1008, nil)
			}
			c.setCredential(credential)
			return c.issueChallenge()
		}
	case *protocol.PairingRequestPayload:
		if !c.beginAttempt(now) {
			return protocol.NewError(protocol.PairingFailed, 1008, nil)
		}
		if !c.endpoint.pairing.consume(payload.PairingCode, now) {
			c.finishAttempt(false)
			return protocol.NewError(protocol.PairingFailed, 1008, nil)
		}
		approvalCtx, cancel := context.WithTimeout(context.Background(), pairingApprovalLimit)
		approval := make(chan bool, 1)
		go func() {
			approval <- c.endpoint.cfg.ApprovePairing(approvalCtx, PairingApproval{Origin: c.origin, ClientInstanceID: c.clientInstanceID, DeviceIdentity: c.device})
		}()
		var approved bool
		select {
		case approved = <-approval:
		case <-approvalCtx.Done():
		}
		cancel()
		if !approved || c.isDone() {
			c.finishAttempt(false)
			return protocol.NewError(protocol.PairingFailed, 1008, nil)
		}
		credential, err := generateCredential(now)
		if err != nil {
			c.finishAttempt(false)
			return err
		}
		if err := c.endpoint.cfg.Credentials.Put(context.Background(), credential); err != nil {
			c.finishAttempt(false)
			return protocol.NewError(protocol.PairingFailed, 1011, err)
		}
		c.setCredential(credential)
		if err := c.send("pairing_result", protocol.PairingResultPayload{CredentialID: credential.ID, CredentialSecret: protocol.EncodeBase64(credential.Secret[:]), CredentialExpiresAt: protocol.FormatTimestamp(credential.ExpiresAt)}); err != nil {
			_ = c.endpoint.cfg.Credentials.Delete(context.Background(), credential.ID)
			c.finishAttempt(false)
			return err
		}
		c.finishAttempt(true)
		if !c.beginAttempt(now) {
			return protocol.NewError(protocol.AuthenticationFailed, 1008, nil)
		}
		return c.issueChallenge()
	case *protocol.AuthResponsePayload:
		credential := c.credentialSnapshot()
		if c.challenge == nil || c.challenge.used || payload.ChallengeID != c.challenge.id || payload.CredentialID != credential.ID || !now.Before(c.challenge.expires) || !now.Before(credential.ExpiresAt) {
			c.finishAttempt(false)
			return protocol.NewError(protocol.AuthenticationFailed, 1008, nil)
		}
		c.challenge.used = true
		proof, ok := protocol.DecodeBase64(payload.Proof, 32)
		expected := authProof(credential.Secret[:], frame.ConnectionID, c.challenge.id, c.challenge.value[:])
		if !ok || subtle.ConstantTimeCompare(proof, expected) != 1 {
			c.finishAttempt(false)
			return protocol.NewError(protocol.AuthenticationFailed, 1008, nil)
		}
		deadline := minTime(now.Add(authorizationLifetime), credential.ExpiresAt)
		c.setAuthorizationDeadline(deadline)
		c.finishAttempt(true)
		c.ws.SetReadDeadline(time.Time{})
		if err := c.send("auth_result", protocol.AuthResultPayload{Authenticated: true, AuthorizationExpiresAt: protocol.FormatTimestamp(deadline)}); err != nil {
			return err
		}
		go c.authorizationLoop(deadline)
		return nil
	case *protocol.HeartbeatPayload:
		if payload.Kind == "ping" {
			return c.send("heartbeat", protocol.HeartbeatPayload{Kind: "pong", Nonce: payload.Nonce})
		}
	case *protocol.OpenSessionPayload:
		id, err := c.endpoint.sessions.open(c, payload.Dimensions)
		if err != nil {
			return protocol.NewError(protocol.SessionOpenFailed, 1011, err)
		}
		return c.send("session_opened", protocol.SessionIDPayload{SessionID: id})
	case *protocol.TerminalPayload:
		data, _ := protocol.DecodeBase64(payload.Data, -1)
		return c.endpoint.sessions.input(c, payload.SessionID, data)
	case *protocol.ResizePayload:
		return c.endpoint.sessions.resize(c, payload.SessionID, payload.Dimensions)
	case *protocol.SessionIDPayload:
		if frame.Type == "detach" {
			grant, expires, err := c.endpoint.sessions.detach(c, payload.SessionID)
			if err != nil {
				return protocol.NewError(protocol.ResumeRejected, 1008, err)
			}
			if err := c.send("session_detached", protocol.SessionDetachedPayload{SessionID: payload.SessionID, ResumeGrant: grant, ExpiresAt: protocol.FormatTimestamp(expires)}); err != nil {
				c.endpoint.sessions.abortTransition(payload.SessionID)
				return err
			}
			return nil
		}
	case *protocol.ResumeSessionPayload:
		if err := c.endpoint.sessions.resume(c, payload.SessionID, payload.ResumeGrant, payload.Dimensions); err != nil {
			return protocol.NewError(protocol.ResumeRejected, 1008, err)
		}
		if err := c.send("session_resumed", protocol.SessionIDPayload{SessionID: payload.SessionID}); err != nil {
			c.endpoint.sessions.abortTransition(payload.SessionID)
			return err
		}
		return c.endpoint.sessions.activateResume(c, payload.SessionID)
	case *protocol.CloseSessionPayload:
		if err := c.endpoint.sessions.closeBy(c, payload.SessionID, payload.Reason); err != nil {
			return err
		}
		return c.send("session_closed", protocol.SessionClosedPayload{SessionID: payload.SessionID, Reason: payload.Reason})
	}
	return nil
}

func (c *connection) issueChallenge() error {
	challenge, err := newChallenge(c.endpoint.cfg.Now())
	if err != nil {
		c.finishAttempt(false)
		return err
	}
	c.challenge = challenge
	c.ws.SetReadDeadline(challenge.expires)
	if err := c.send("auth_challenge", protocol.AuthChallengePayload{ChallengeID: challenge.id, Challenge: protocol.EncodeBase64(challenge.value[:]), ExpiresAt: protocol.FormatTimestamp(challenge.expires)}); err != nil {
		c.finishAttempt(false)
		return err
	}
	return nil
}

func (c *connection) send(messageType string, payload any) error {
	c.protocolMu.Lock()
	defer c.protocolMu.Unlock()
	frame, err := protocol.NewFrame(messageType, c.id, c.machine.NextSequence(protocol.AgentToClient), payload)
	if err != nil {
		return err
	}
	decoded := protocol.DecodedFrame{Frame: frame, Value: payload}
	if err := c.machine.Apply(protocol.AgentToClient, decoded); err != nil {
		return err
	}
	item := outbound{frame: frame, result: make(chan error, 1)}
	select {
	case c.writes <- item:
	case <-c.done:
		return io.ErrClosedPipe
	default:
		return protocol.NewError(protocol.BackpressureLimit, 1008, nil)
	}
	select {
	case err := <-item.result:
		return err
	case <-c.done:
		return io.ErrClosedPipe
	}
}

func (c *connection) writeLoop() {
	for {
		select {
		case item := <-c.writes:
			data, err := protocol.Marshal(item.frame)
			if err == nil {
				err = c.ws.SetWriteDeadline(time.Now().Add(writeLimit))
			}
			if err == nil {
				err = c.ws.WriteMessage(websocket.TextMessage, data)
			}
			item.result <- err
			if err != nil {
				c.shutdown()
				return
			}
		case <-c.done:
			return
		}
	}
}

func (c *connection) heartbeatLoop() {
	ticker := time.NewTicker(heartbeatPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if c.connectionState() != protocol.ConnectionReady {
				continue
			}
			if c.sinceSeen() >= livenessLimit {
				c.fail(protocol.NewError(protocol.HeartbeatTimeout, 1008, nil))
				return
			}
			var nonce [16]byte
			if _, err := rand.Read(nonce[:]); err != nil {
				c.shutdown()
				return
			}
			if err := c.send("heartbeat", protocol.HeartbeatPayload{Kind: "ping", Nonce: protocol.EncodeBase64(nonce[:])}); err != nil {
				c.shutdown()
				return
			}
		case <-c.done:
			return
		}
	}
}

func (c *connection) applyIncoming(frame protocol.DecodedFrame) error {
	c.protocolMu.Lock()
	defer c.protocolMu.Unlock()
	if c.id == "" {
		c.id = frame.ConnectionID
		if !c.endpoint.claimConnectionID(frame.ConnectionID) {
			return protocol.NewError(protocol.InvalidState, 1008, nil)
		}
	}
	if frame.ConnectionID != c.id {
		return protocol.NewError(protocol.SchemaInvalid, 1002, nil)
	}
	if _, ok := frame.Value.(*protocol.ResumeSessionPayload); ok && c.machine.Connection == protocol.ConnectionReady {
		c.machine.SetSession(protocol.SessionDetached)
	}
	return c.machine.Apply(protocol.ClientToAgent, frame)
}

func (c *connection) connectionState() protocol.ConnectionState {
	c.protocolMu.Lock()
	defer c.protocolMu.Unlock()
	return c.machine.Connection
}

func (c *connection) sessionState() protocol.SessionState {
	c.protocolMu.Lock()
	defer c.protocolMu.Unlock()
	return c.machine.Session
}

func (c *connection) fail(err error) {
	c.failOnce.Do(func() {
		code, closeCode, ok := protocol.ErrorDetails(err)
		if !ok {
			code, closeCode = protocol.InvalidState, 1011
		}
		connectionID := c.connectionID()
		c.endpoint.cfg.Log(Event{Name: "connection_rejected", Code: code, ConnectionID: connectionID})
		if connectionID != "" {
			_ = c.send("error", protocol.ErrorPayload{Code: code, Fatal: true})
		}
		_ = c.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(closeCode, string(code)), time.Now().Add(time.Second))
		c.shutdown()
	})
}

func (c *connection) authorizationLoop(deadline time.Time) {
	for {
		remaining := deadline.Sub(c.endpoint.cfg.Now())
		if remaining <= 0 {
			c.fail(protocol.NewError(protocol.AuthorizationExpired, 1008, nil))
			return
		}
		timer := time.NewTimer(remaining)
		select {
		case <-timer.C:
		case <-c.done:
			timer.Stop()
			return
		}
	}
}

func (c *connection) shutdown() {
	c.closeOnce.Do(func() {
		c.finishAttempt(false)
		close(c.done)
		c.endpoint.unregister(c)
		c.endpoint.sessions.disconnected(c)
		_ = c.ws.Close()
	})
}

func (c *connection) beginAttempt(now time.Time) bool {
	c.attemptMu.Lock()
	defer c.attemptMu.Unlock()
	if c.attemptReserved || !c.endpoint.limiter.begin(c.device, now) {
		return false
	}
	c.attemptReserved = true
	return true
}

func (c *connection) finishAttempt(success bool) {
	c.attemptMu.Lock()
	if !c.attemptReserved {
		c.attemptMu.Unlock()
		return
	}
	c.attemptReserved = false
	c.attemptMu.Unlock()
	c.endpoint.limiter.finish(c.device, c.endpoint.cfg.Now(), success)
}

func (c *connection) isDone() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

func (c *connection) setCredential(credential Credential) {
	c.authMu.Lock()
	c.credential = credential
	c.authMu.Unlock()
}
func (c *connection) credentialSnapshot() Credential {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.credential
}
func (c *connection) credentialID() string { return c.credentialSnapshot().ID }
func (c *connection) connectionID() string {
	c.protocolMu.Lock()
	defer c.protocolMu.Unlock()
	return c.id
}
func (c *connection) setAuthorizationDeadline(deadline time.Time) {
	c.authMu.Lock()
	c.authorizedUntil = deadline
	c.authMu.Unlock()
}
func (c *connection) authorizationDeadline() time.Time {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.authorizedUntil
}

func (c *connection) markSeen() {
	c.lastSeenMu.Lock()
	c.lastSeen = c.endpoint.cfg.Now()
	c.lastSeenMu.Unlock()
}
func (c *connection) sinceSeen() time.Duration {
	c.lastSeenMu.Lock()
	defer c.lastSeenMu.Unlock()
	return c.endpoint.cfg.Now().Sub(c.lastSeen)
}

func generateCredential(now time.Time) (Credential, error) {
	id, err := randomUUID()
	if err != nil {
		return Credential{}, err
	}
	result := Credential{ID: id, ExpiresAt: now.Add(credentialLifetime)}
	_, err = rand.Read(result.Secret[:])
	return result, err
}

func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}
func containsString(values []string, value string) bool {
	for _, candidate := range values {
		if candidate == value {
			return true
		}
	}
	return false
}
