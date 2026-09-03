package endpoint

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

const (
	testOrigin   = "https://preview.example.invalid"
	testAgentID  = "50000000-0000-4000-8000-000000000001"
	testClientID = "40000000-0000-4000-8000-000000000001"
)

type fakeAdapter struct {
	mu       sync.Mutex
	sessions []*fakeSession
}

type memoryCredentialStore struct {
	mu          sync.RWMutex
	credentials map[string]Credential
}

type blockingCredentialStore struct {
	*memoryCredentialStore
	getStarted chan struct{}
	releaseGet chan struct{}
	once       sync.Once
}

func (s *blockingCredentialStore) Get(ctx context.Context, id string) (Credential, error) {
	credential, err := s.memoryCredentialStore.Get(ctx, id)
	s.once.Do(func() { close(s.getStarted) })
	<-s.releaseGet
	return credential, err
}

type blockingCloseAdapter struct{ session *blockingCloseSession }
type blockingCloseSession struct {
	*fakeSession
	closeStarted chan struct{}
	releaseClose chan struct{}
	closeErr     error
	onceBlock    sync.Once
}

func (a *blockingCloseAdapter) Open(context.Context, terminal.Config) (terminal.Session, error) {
	return a.session, nil
}
func (s *blockingCloseSession) Close() error {
	s.onceBlock.Do(func() { close(s.closeStarted); <-s.releaseClose; s.fakeSession.Close() })
	return s.closeErr
}

func newMemoryCredentialStore() *memoryCredentialStore {
	return &memoryCredentialStore{credentials: make(map[string]Credential)}
}
func (s *memoryCredentialStore) Put(_ context.Context, credential Credential) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.credentials[credential.ID] = credential
	return nil
}
func (s *memoryCredentialStore) Get(_ context.Context, id string) (Credential, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	credential, ok := s.credentials[id]
	if !ok {
		return Credential{}, errors.New("credential not found")
	}
	return credential, nil
}
func (s *memoryCredentialStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.credentials, id)
	return nil
}

type fakeSession struct {
	mu            sync.Mutex
	input         bytes.Buffer
	output        chan []byte
	closed        chan struct{}
	once          sync.Once
	columns, rows uint16
}

func (a *fakeAdapter) Open(_ context.Context, config terminal.Config) (terminal.Session, error) {
	s := &fakeSession{output: make(chan []byte, 4), closed: make(chan struct{}), columns: config.Columns, rows: config.Rows}
	a.mu.Lock()
	a.sessions = append(a.sessions, s)
	a.mu.Unlock()
	return s, nil
}
func (s *fakeSession) Read(target []byte) (int, error) {
	select {
	case data := <-s.output:
		return copy(target, data), nil
	case <-s.closed:
		return 0, io.EOF
	}
}
func (s *fakeSession) Write(data []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.input.Write(data)
}
func (s *fakeSession) Resize(columns, rows uint16) error {
	s.mu.Lock()
	s.columns, s.rows = columns, rows
	s.mu.Unlock()
	return nil
}
func (s *fakeSession) Wait() error  { <-s.closed; return nil }
func (s *fakeSession) Close() error { s.once.Do(func() { close(s.closed) }); return nil }

type testClient struct {
	t        *testing.T
	ws       *websocket.Conn
	id       string
	sequence uint64
}

func (c *testClient) send(messageType string, payload any) {
	c.t.Helper()
	frame, err := protocol.NewFrame(messageType, c.id, c.sequence, payload)
	if err != nil {
		c.t.Fatal(err)
	}
	c.sequence++
	data, _ := protocol.Marshal(frame)
	if err := c.ws.WriteMessage(websocket.TextMessage, data); err != nil {
		c.t.Fatal(err)
	}
}
func (c *testClient) read(want string) protocol.DecodedFrame {
	c.t.Helper()
	_, data, err := c.ws.ReadMessage()
	if err != nil {
		c.t.Fatal(err)
	}
	frame, err := protocol.Decode(data)
	if err != nil {
		c.t.Fatal(err)
	}
	if frame.Type != want {
		c.t.Fatalf("type = %s, want %s", frame.Type, want)
	}
	return frame
}

func newTestEndpoint(t *testing.T) (*Endpoint, *fakeAdapter, *memoryCredentialStore) {
	t.Helper()
	adapter := &fakeAdapter{}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "device-1", nil }})
	if err != nil {
		t.Fatal(err)
	}
	return endpoint, adapter, store
}

func dial(t *testing.T, server *httptest.Server, origin, subprotocol string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, Subprotocols: []string{subprotocol}}
	return dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/terminal", http.Header{"Origin": []string{origin}})
}

func pairAndAuthorize(t *testing.T, endpoint *Endpoint, server *httptest.Server) (*testClient, Credential) {
	t.Helper()
	code, _, err := endpoint.IssuePairingCode()
	if err != nil {
		t.Fatal(err)
	}
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000001"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	client.read("hello_ack")
	client.send("pairing_request", protocol.PairingRequestPayload{PairingCode: code})
	pair := client.read("pairing_result").Value.(*protocol.PairingResultPayload)
	challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
	secret, _ := protocol.DecodeBase64(pair.CredentialSecret, 32)
	challengeBytes, _ := protocol.DecodeBase64(challenge.Challenge, 32)
	proof := authProof(secret, client.id, challenge.ChallengeID, challengeBytes)
	client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: pair.CredentialID, Proof: protocol.EncodeBase64(proof)})
	client.read("auth_result")
	credential, err := endpoint.cfg.Credentials.Get(context.Background(), pair.CredentialID)
	if err != nil {
		t.Fatal(err)
	}
	return client, credential
}

func authorizeExisting(t *testing.T, server *httptest.Server, credential Credential, connectionID string) *testClient {
	t.Helper()
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: connectionID}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: credential.ID, SupportedVersions: []string{protocol.Version}})
	client.read("hello_ack")
	challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
	challengeBytes, _ := protocol.DecodeBase64(challenge.Challenge, 32)
	client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: credential.ID, Proof: protocol.EncodeBase64(authProof(credential.Secret[:], connectionID, challenge.ChallengeID, challengeBytes))})
	client.read("auth_result")
	return client
}

func TestPrivateWSSLifecycleDetachResumeAndCleanup(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	nonce := protocol.EncodeBase64(make([]byte, 16))
	client.send("heartbeat", protocol.HeartbeatPayload{Kind: "ping", Nonce: nonce})
	if heartbeat := client.read("heartbeat").Value.(*protocol.HeartbeatPayload); heartbeat.Kind != "pong" || heartbeat.Nonce != nonce {
		t.Fatal("heartbeat response mismatch")
	}
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	client.send("terminal_input", protocol.TerminalPayload{SessionID: sessionID, Data: protocol.EncodeBase64([]byte("input-marker"))})
	client.send("resize", protocol.ResizePayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 120, Rows: 40}})
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	var gotInput string
	var columns, rows uint16
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		session.mu.Lock()
		gotInput, columns, rows = session.input.String(), session.columns, session.rows
		session.mu.Unlock()
		if gotInput == "input-marker" && columns == 120 && rows == 40 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	if gotInput != "input-marker" || columns != 120 || rows != 40 {
		t.Fatalf("input/resize = %q %dx%d", gotInput, columns, rows)
	}
	session.output <- []byte("output-marker")
	output := client.read("terminal_output").Value.(*protocol.TerminalPayload)
	decoded, _ := protocol.DecodeBase64(output.Data, -1)
	if string(decoded) != "output-marker" {
		t.Fatal("output mismatch")
	}
	client.send("detach", protocol.SessionIDPayload{SessionID: sessionID})
	detached := client.read("session_detached").Value.(*protocol.SessionDetachedPayload)
	client.send("resume_session", protocol.ResumeSessionPayload{SessionID: sessionID, ResumeGrant: detached.ResumeGrant, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.ResumeRejected {
		t.Fatalf("same-connection resume code = %s", got)
	}
	_ = client.ws.Close()
	session.output <- []byte("pending-marker")
	resumed := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000002")
	resumed.send("resume_session", protocol.ResumeSessionPayload{SessionID: sessionID, ResumeGrant: detached.ResumeGrant, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	resumed.read("session_resumed")
	pending := resumed.read("terminal_output").Value.(*protocol.TerminalPayload)
	pendingBytes, _ := protocol.DecodeBase64(pending.Data, -1)
	if string(pendingBytes) != "pending-marker" {
		t.Fatal("pending output mismatch")
	}
	replay := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000003")
	replay.send("resume_session", protocol.ResumeSessionPayload{SessionID: sessionID, ResumeGrant: detached.ResumeGrant, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	if got := replay.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.ResumeRejected {
		t.Fatalf("replayed grant code = %s", got)
	}
	resumed.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "user_request"})
	resumed.read("session_closed")
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("terminal was not closed")
	}
}

func TestAttachedClientLossCleansTerminal(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client, _ := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	client.read("session_opened")
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	_ = client.ws.Close()
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("client loss left terminal active")
	}
}

func TestHandshakeOriginProtocolAndTLSRejections(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	for _, item := range []struct {
		name, origin, subprotocol string
		status                    int
	}{{"origin", "https://attacker.invalid", protocol.Subprotocol, 403}, {"missing-origin", "", protocol.Subprotocol, 403}, {"subprotocol", testOrigin, "other.v1", 426}} {
		t.Run(item.name, func(t *testing.T) {
			ws, response, err := dial(t, server, item.origin, item.subprotocol)
			if ws != nil {
				ws.Close()
			}
			if err == nil || response == nil || response.StatusCode != item.status {
				t.Fatalf("status = %v err=%v", response, err)
			}
		})
	}
	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/terminal", nil)
	request.Header.Set("Origin", testOrigin)
	request.Header.Set("Sec-WebSocket-Protocol", protocol.Subprotocol)
	recorder := httptest.NewRecorder()
	endpoint.ServeHTTP(recorder, request)
	if recorder.Code != 403 {
		t.Fatalf("insecure status = %d", recorder.Code)
	}
}

func TestAuthorizationExpiryClosesConnection(t *testing.T) {
	base := time.Now().UTC().Truncate(time.Millisecond)
	var nanos atomic.Int64
	nanos.Store(base.UnixNano())
	adapter := &fakeAdapter{}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "device-expiry", nil },
		Now: func() time.Time { return time.Unix(0, nanos.Load()).UTC() }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	client, _ := pairAndAuthorize(t, endpoint, server)
	nanos.Store(base.Add(13 * time.Hour).UnixNano())
	client.send("heartbeat", protocol.HeartbeatPayload{Kind: "ping", Nonce: protocol.EncodeBase64(make([]byte, 16))})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthorizationExpired {
		t.Fatalf("code = %s", got)
	}
}

func TestAuthorizationDeadlineProactivelyCloses(t *testing.T) {
	endpoint, adapter, store := newTestEndpoint(t)
	credential := Credential{ID: "30000000-0000-4000-8000-000000000050", ExpiresAt: time.Now().Add(time.Second)}
	for index := range credential.Secret {
		credential.Secret[index] = byte(index)
	}
	if err := store.Put(context.Background(), credential); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	client := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000050")
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	client.read("session_opened")
	_ = client.ws.SetReadDeadline(time.Now().Add(time.Second))
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthorizationExpired {
		t.Fatalf("code = %s", got)
	}
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("expired authorization left terminal open")
	}
}

func TestConcurrentRateLimitReservations(t *testing.T) {
	limiter := newRateLimiter()
	now := time.Now()
	var admitted atomic.Int64
	var wait sync.WaitGroup
	start := make(chan struct{})
	for range 20 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			<-start
			if limiter.begin("device", now) {
				admitted.Add(1)
			}
		}()
	}
	close(start)
	wait.Wait()
	if admitted.Load() != 5 {
		t.Fatalf("admitted = %d", admitted.Load())
	}
	for range 5 {
		limiter.finish("device", now, false)
	}
	if limiter.allowed("device", now) {
		t.Fatal("cooldown was not enforced")
	}
	if !limiter.allowed("device", now.Add(5*time.Minute+time.Millisecond)) {
		t.Fatal("expired cooldown was not released")
	}
}

func TestConnectionIDCannotBeReused(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	id := "10000000-0000-4000-8000-000000000060"
	firstWS, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	first := &testClient{t: t, ws: firstWS, id: id}
	first.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	first.read("hello_ack")
	secondWS, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	second := &testClient{t: t, ws: secondWS, id: id}
	second.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	if got := second.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.InvalidState {
		t.Fatalf("code = %s", got)
	}
	firstWS.Close()
	secondWS.Close()
}

func TestCredentialRevocationClosesAuthorizationAndSession(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	client.read("session_opened")
	if err := endpoint.RevokeCredential(context.Background(), credential.ID); err != nil {
		t.Fatal(err)
	}
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("revocation left terminal open")
	}
	client.read("session_closed")
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
		t.Fatalf("code = %s", got)
	}
}

func TestRevocationCannotRaceCredentialBinding(t *testing.T) {
	memory := newMemoryCredentialStore()
	store := &blockingCredentialStore{memoryCredentialStore: memory, getStarted: make(chan struct{}), releaseGet: make(chan struct{})}
	credential := Credential{ID: "30000000-0000-4000-8000-000000000080", ExpiresAt: time.Now().Add(time.Hour)}
	if err := store.Put(context.Background(), credential); err != nil {
		t.Fatal(err)
	}
	adapter := &fakeAdapter{}
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store, ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "revocation-race-device", nil }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000080"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: credential.ID, SupportedVersions: []string{"0.1"}})
	client.read("hello_ack")
	<-store.getStarted
	if err := endpoint.RevokeCredential(context.Background(), credential.ID); err != nil {
		t.Fatal(err)
	}
	close(store.releaseGet)
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
		t.Fatalf("code = %s", got)
	}
}

func TestClosingSessionKeepsReservationAndReturnsCleanupError(t *testing.T) {
	sentinel := errors.New("synthetic cleanup failure")
	inner := &fakeSession{output: make(chan []byte), closed: make(chan struct{})}
	blocking := &blockingCloseSession{fakeSession: inner, closeStarted: make(chan struct{}), releaseClose: make(chan struct{}), closeErr: sentinel}
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: &blockingCloseAdapter{session: blocking}, Credentials: newMemoryCredentialStore(), ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "cleanup-device", nil }})
	if err != nil {
		t.Fatal(err)
	}
	owner := &connection{credential: Credential{ID: "30000000-0000-4000-8000-000000000081"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	if _, err := endpoint.sessions.open(owner, protocol.Dimensions{Columns: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { result <- endpoint.Close() }()
	<-blocking.closeStarted
	other := &connection{credential: Credential{ID: "30000000-0000-4000-8000-000000000082"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	if _, err := endpoint.sessions.open(other, protocol.Dimensions{Columns: 80, Rows: 24}); err == nil {
		t.Fatal("new session opened while prior cleanup was in progress")
	}
	close(blocking.releaseClose)
	if err := <-result; !errors.Is(err, sentinel) {
		t.Fatalf("cleanup error = %v", err)
	}
}

func TestEndpointShutdownPermanentlyClosesSessionAdmission(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	if err := endpoint.Close(); err != nil {
		t.Fatal(err)
	}
	owner := &connection{credential: Credential{ID: "30000000-0000-4000-8000-000000000083"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	if _, err := endpoint.sessions.open(owner, protocol.Dimensions{Columns: 80, Rows: 24}); err == nil {
		t.Fatal("session opened after endpoint shutdown began")
	}
}

func TestUnsupportedNegotiationAndExpiredChallenge(t *testing.T) {
	base := time.Now().UTC().Truncate(time.Millisecond)
	var nanos atomic.Int64
	nanos.Store(base.UnixNano())
	adapter := &fakeAdapter{}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store, ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "device-semantic", nil }, Now: func() time.Time { return time.Unix(0, nanos.Load()).UTC() }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	unsupportedWS, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	unsupported := &testClient{t: t, ws: unsupportedWS, id: "10000000-0000-4000-8000-000000000030"}
	unsupported.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.2"}})
	if got := unsupported.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.UnsupportedVersion {
		t.Fatalf("code = %s", got)
	}
	unsupportedWS.Close()
	code, _, _ := endpoint.IssuePairingCode()
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000031"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	client.read("hello_ack")
	client.send("pairing_request", protocol.PairingRequestPayload{PairingCode: code})
	pair := client.read("pairing_result").Value.(*protocol.PairingResultPayload)
	challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
	nanos.Store(base.Add(11 * time.Second).UnixNano())
	client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: pair.CredentialID, Proof: protocol.EncodeBase64(make([]byte, 32))})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
		t.Fatalf("code = %s", got)
	}
}

func TestAuthenticationReplayOversizeAndPairingConsumption(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	code, _, _ := endpoint.IssuePairingCode()
	ws, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000010"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	client.read("hello_ack")
	wrong := protocol.EncodeBase64(make([]byte, 16))
	client.send("pairing_request", protocol.PairingRequestPayload{PairingCode: wrong})
	client.read("error")
	ws.Close()
	ws2, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	c2 := &testClient{t: t, ws: ws2, id: "10000000-0000-4000-8000-000000000011"}
	c2.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	c2.read("hello_ack")
	c2.send("pairing_request", protocol.PairingRequestPayload{PairingCode: code})
	frame := c2.read("error")
	if frame.Value.(*protocol.ErrorPayload).Code != protocol.PairingFailed {
		t.Fatal("pairing code was not consumed")
	}
	ws2.Close()
	if _, err := protocol.Decode(append([]byte(`{"version":"0.1"}`), bytes.Repeat([]byte(" "), protocol.MaxWireBytes)...)); errorCode(err) != protocol.FrameTooLarge {
		t.Fatal("oversize frame accepted")
	}
	machine := protocol.NewMachine(protocol.ConnectionNew, protocol.SessionNone, 0, 0)
	hello, _ := protocol.NewFrame("hello", "10000000-0000-4000-8000-000000000012", 0, protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	data, _ := protocol.Marshal(hello)
	decoded, _ := protocol.Decode(data)
	if err := machine.Apply(protocol.ClientToAgent, decoded); err != nil {
		t.Fatal(err)
	}
	if errorCode(machine.Apply(protocol.ClientToAgent, decoded)) != protocol.SequenceReplay {
		t.Fatal("replay accepted")
	}
}

func TestWSSOversizeMessageClosesWith1009(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000013"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	client.read("hello_ack")
	if err := ws.WriteMessage(websocket.TextMessage, bytes.Repeat([]byte(" "), protocol.MaxWireBytes+1)); err != nil {
		t.Fatal(err)
	}
	_, _, err = ws.ReadMessage()
	var closeError *websocket.CloseError
	if !errors.As(err, &closeError) || closeError.Code != 1009 {
		t.Fatalf("close error = %v", err)
	}
}

func TestWrongAuthenticationProofAndSequenceReplayAreRejected(t *testing.T) {
	endpoint, _, store := newTestEndpoint(t)
	credential := Credential{ID: "30000000-0000-4000-8000-000000000001", ExpiresAt: time.Now().Add(time.Hour)}
	for index := range credential.Secret {
		credential.Secret[index] = byte(index)
	}
	if err := store.Put(context.Background(), credential); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	ws, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000020"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: credential.ID, SupportedVersions: []string{"0.1"}})
	client.read("hello_ack")
	challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
	client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: credential.ID, Proof: protocol.EncodeBase64(make([]byte, 32))})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
		t.Fatalf("code = %s", got)
	}
	_ = ws.Close()

	replayWS, _, err := dial(t, server, testOrigin, protocol.Subprotocol)
	if err != nil {
		t.Fatal(err)
	}
	replay := &testClient{t: t, ws: replayWS, id: "10000000-0000-4000-8000-000000000021"}
	replay.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	replay.read("hello_ack")
	duplicate, _ := protocol.NewFrame("hello", replay.id, 0, protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"0.1"}})
	raw, _ := protocol.Marshal(duplicate)
	if err := replayWS.WriteMessage(websocket.TextMessage, raw); err != nil {
		t.Fatal(err)
	}
	if got := replay.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.SequenceReplay {
		t.Fatalf("code = %s", got)
	}
}

func TestEndpointCloseCleansActiveTerminal(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	client, _ := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	client.read("session_opened")
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	if err := endpoint.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("agent shutdown left terminal active")
	}
	_ = client.ws.SetReadDeadline(time.Now().Add(time.Second))
	var connectionErr error
	for {
		if _, _, err := client.ws.ReadMessage(); err != nil {
			connectionErr = err
			break
		}
	}
	var timeout interface{ Timeout() bool }
	if errors.As(connectionErr, &timeout) && timeout.Timeout() {
		t.Fatal("agent shutdown left WSS connection open")
	}
}

func TestSessionRegistryEnforcesOneSession(t *testing.T) {
	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	first := &connection{credential: Credential{ID: "30000000-0000-4000-8000-000000000001"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	second := &connection{credential: Credential{ID: "30000000-0000-4000-8000-000000000002"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	id, err := registry.open(first, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.open(second, protocol.Dimensions{Columns: 80, Rows: 24}); err == nil {
		t.Fatal("second terminal session was accepted")
	}
	if err := registry.closeBy(first, id, "user_request"); err != nil {
		t.Fatal(err)
	}
}

func TestCanonicalAuthenticationProof(t *testing.T) {
	secret := make([]byte, 32)
	challenge := make([]byte, 32)
	for index := range secret {
		secret[index] = byte(index)
		challenge[index] = byte(index + 32)
	}
	proof := protocol.EncodeBase64(authProof(secret, "10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001", challenge))
	if proof != "Lc7B_pWvNKrS7lyj12dhdOZOh4NHEmLDgR1Rgc4TVYE" {
		t.Fatalf("proof = %s", proof)
	}
}

func TestGeneratedCredentialExpiresInsideThirtyDayClientBoundary(t *testing.T) {
	now := time.Date(2026, time.August, 26, 12, 0, 0, 0, time.UTC)
	credential, err := generateCredential(now)
	if err != nil {
		t.Fatal(err)
	}
	want := now.Add(30*24*time.Hour - 5*time.Minute)
	if !credential.ExpiresAt.Equal(want) {
		t.Fatalf("expiry = %s, want %s", credential.ExpiresAt, want)
	}
	if !credential.ExpiresAt.Before(now.Add(30 * 24 * time.Hour)) {
		t.Fatal("credential expiry must leave client clock-skew headroom")
	}
}

func TestServeTLSRejectsNonLoopbackListener(t *testing.T) {
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Skip(err)
	}
	defer listener.Close()
	if err := ServeTLS(listener, &tls.Config{Certificates: []tls.Certificate{{}}}, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})); err == nil || !strings.Contains(err.Error(), "loopback") {
		t.Fatalf("error = %v", err)
	}
}

func TestServeTLSAcceptsLoopbackHTTPS(t *testing.T) {
	certificate := testCertificate(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		done <- ServeTLS(listener, &tls.Config{Certificates: []tls.Certificate{certificate}}, http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { response.WriteHeader(http.StatusNoContent) }))
	}()
	client := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	response, err := client.Get("https://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d", response.StatusCode)
	}
	listener.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("TLS server did not stop")
	}
}

func testCertificate(t *testing.T) tls.Certificate {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "127.0.0.1"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), KeyUsage: x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	certificate, err := tls.X509KeyPair(certificatePEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return certificate
}

func TestLoggerReceivesNoSecretsOrTerminalPlaintext(t *testing.T) {
	var encoded []byte
	log := func(event Event) { encoded, _ = json.Marshal(event) }
	log(Event{Name: "connection_rejected", Code: protocol.AuthenticationFailed, ConnectionID: "10000000-0000-4000-8000-000000000001"})
	text := string(encoded)
	for _, forbidden := range []string{"input-marker", "credentialSecret", "resumeGrant", "challenge"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("log contained %q", forbidden)
		}
	}
}

func errorCode(err error) protocol.ErrorCode { code, _, _ := protocol.ErrorDetails(err); return code }
