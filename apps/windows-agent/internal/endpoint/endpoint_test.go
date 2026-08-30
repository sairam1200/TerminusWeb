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
	"fmt"
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

// ignoringContextOpenAdapter deliberately models a terminal implementation
// that does not return when its context is cancelled. Tests release the
// adapter explicitly so they can prove registry operations remain independent
// and that any terminal created after admission is invalidated is closed.
type ignoringContextOpenAdapter struct {
	mu        sync.Mutex
	calls     int
	stallFrom int
	started   chan int
	release   chan struct{}
	releaseMu sync.Once
	sessions  []*fakeSession
}

// lateTerminalAfterCancellationAdapter models a broken terminal adapter that
// observes cancellation but still creates and returns a terminal. The endpoint
// must close that late terminal instead of registering it.
type lateTerminalAfterCancellationAdapter struct {
	started   chan struct{}
	cancelled chan struct{}
	created   chan *fakeSession
}

func newLateTerminalAfterCancellationAdapter() *lateTerminalAfterCancellationAdapter {
	return &lateTerminalAfterCancellationAdapter{
		started:   make(chan struct{}),
		cancelled: make(chan struct{}),
		created:   make(chan *fakeSession, 1),
	}
}

func (a *lateTerminalAfterCancellationAdapter) Open(ctx context.Context, config terminal.Config) (terminal.Session, error) {
	close(a.started)
	<-ctx.Done()
	close(a.cancelled)
	session := &fakeSession{
		output:  make(chan []byte, 4),
		closed:  make(chan struct{}),
		columns: config.Columns,
		rows:    config.Rows,
	}
	a.created <- session
	return session, nil
}

func newIgnoringContextOpenAdapter(stallFrom, capacity int) *ignoringContextOpenAdapter {
	return &ignoringContextOpenAdapter{
		stallFrom: stallFrom,
		started:   make(chan int, capacity),
		release:   make(chan struct{}),
	}
}

func (a *ignoringContextOpenAdapter) Open(_ context.Context, config terminal.Config) (terminal.Session, error) {
	a.mu.Lock()
	a.calls++
	call := a.calls
	a.mu.Unlock()
	if call >= a.stallFrom {
		a.started <- call
		<-a.release
	}
	session := &fakeSession{
		output:  make(chan []byte, 4),
		closed:  make(chan struct{}),
		columns: config.Columns,
		rows:    config.Rows,
	}
	a.mu.Lock()
	a.sessions = append(a.sessions, session)
	a.mu.Unlock()
	return session, nil
}

func (a *ignoringContextOpenAdapter) unblock() {
	a.releaseMu.Do(func() { close(a.release) })
}

func (a *ignoringContextOpenAdapter) snapshot() []*fakeSession {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]*fakeSession(nil), a.sessions...)
}

type failingOpenAdapter struct{ err error }

func (a failingOpenAdapter) Open(context.Context, terminal.Config) (terminal.Session, error) {
	return nil, a.err
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

type resizeOutputAdapter struct{ session *resizeOutputSession }
type resizeOutputSession struct {
	*fakeSession
	outputOnResize []byte
}

func (a *resizeOutputAdapter) Open(context.Context, terminal.Config) (terminal.Session, error) {
	return a.session, nil
}

func (s *resizeOutputSession) Resize(columns, rows uint16) error {
	if err := s.fakeSession.Resize(columns, rows); err != nil {
		return err
	}
	if len(s.outputOnResize) > 0 {
		s.output <- append([]byte(nil), s.outputOnResize...)
		s.outputOnResize = nil
	}
	return nil
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

func waitSessionState(t *testing.T, session *fakeSession, input string, columns, rows uint16) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		session.mu.Lock()
		gotInput, gotColumns, gotRows := session.input.String(), session.columns, session.rows
		session.mu.Unlock()
		if gotInput == input && gotColumns == columns && gotRows == rows {
			return
		}
		time.Sleep(time.Millisecond)
	}
	session.mu.Lock()
	gotInput, gotColumns, gotRows := session.input.String(), session.columns, session.rows
	session.mu.Unlock()
	t.Fatalf("session state = %q %dx%d, want %q %dx%d", gotInput, gotColumns, gotRows, input, columns, rows)
}

func testRegistryOwner(credentialID string) *connection {
	return &connection{
		credential: Credential{ID: credentialID},
		device:     "device-1",
		done:       make(chan struct{}),
		machine:    protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0),
	}
}

func awaitTestError(t *testing.T, label string, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-time.After(3 * time.Second):
		t.Fatalf("%s did not complete", label)
		return nil
	}
}

func requireTestSessionClosed(t *testing.T, label string, session *fakeSession) {
	t.Helper()
	select {
	case <-session.closed:
	case <-time.After(3 * time.Second):
		t.Fatalf("%s left a terminal active", label)
	}
}

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

// This proves only the server-side once-per-device credential behavior.
// Browser certificate import, selection, and persistence remain external
// platform behavior and are not asserted by this test.
func TestStoredCredentialReconnectDoesNotRepeatLocalPairingApproval(t *testing.T) {
	adapter := &fakeAdapter{}
	store := newMemoryCredentialStore()
	var approvals atomic.Int64
	endpoint, err := New(Config{
		AllowedOrigin: testOrigin,
		AgentID:       testAgentID,
		Terminal:      adapter,
		Credentials:   store,
		ApprovePairing: func(context.Context, PairingApproval) bool {
			approvals.Add(1)
			return true
		},
		ResolveDevice: func(*http.Request) (string, error) { return "credential-reuse-device", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()

	first, credential := pairAndAuthorize(t, endpoint, server)
	if got := approvals.Load(); got != 1 {
		t.Fatalf("local pairing approvals = %d, want 1 after initial pairing", got)
	}
	if err := first.ws.Close(); err != nil {
		t.Fatal(err)
	}

	reconnected := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000098")
	defer reconnected.ws.Close()
	if got := approvals.Load(); got != 1 {
		t.Fatalf("local pairing approvals = %d, want 1 after stored-credential reconnect", got)
	}
}

func TestPrivateWSSLifecycleDetachReopenHistoryAndCleanup(t *testing.T) {
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
	output := client.read("terminal_output").Value.(*protocol.TerminalOutputPayload)
	decoded, _ := protocol.DecodeBase64(output.Data, -1)
	if string(decoded) != "output-marker" || output.Offset != 0 {
		t.Fatal("output mismatch")
	}
	client.send("detach", protocol.SessionIDPayload{SessionID: sessionID})
	client.read("session_detached")
	_ = client.ws.Close()
	session.output <- []byte("pending-marker")
	reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000002")
	reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	reopened.read("session_reopened")
	begin := reopened.read("history_begin").Value.(*protocol.HistoryBeginPayload)
	var history []byte
	for uint64(len(history))+begin.StartOffset < begin.EndOffset {
		chunk := reopened.read("history_chunk").Value.(*protocol.HistoryChunkPayload)
		decoded, _ := protocol.DecodeBase64(chunk.Data, -1)
		history = append(history, decoded...)
	}
	end := reopened.read("history_end").Value.(*protocol.HistoryEndPayload)
	if string(history) != "output-markerpending-marker" || begin.StartOffset != 0 || begin.Truncated || end.EndOffset != uint64(len(history)) {
		t.Fatalf("history = %q begin=%+v end=%+v", history, begin, end)
	}

	loser := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000003")
	loser.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	if got := loser.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.SessionReopenRejected {
		t.Fatalf("concurrent reopen code = %s", got)
	}
	reopened.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "new_session"})
	reopened.read("session_closed")
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("terminal was not closed")
	}
	endpoint.sessions.mu.Lock()
	historyBytes := endpoint.sessions.historyBytes
	endpoint.sessions.mu.Unlock()
	if historyBytes != 0 {
		t.Fatalf("history bytes after close = %d", historyBytes)
	}
	closedID := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000004")
	closedID.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	if got := closedID.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.SessionReopenRejected {
		t.Fatalf("closed ID reopen code = %s", got)
	}
}

func TestAttachedClientLossDetachesAndReopensTerminal(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	_ = client.ws.Close()
	time.Sleep(20 * time.Millisecond)
	select {
	case <-session.closed:
		t.Fatal("ordinary client loss closed retained terminal")
	default:
	}
	reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000097")
	reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	reopened.read("session_reopened")
	reopened.read("history_begin")
	reopened.read("history_end")
	reopened.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "user_request"})
	reopened.read("session_closed")
}

func TestSessionIDFormatUniquenessAndCollisionRetriesBeforeOpen(t *testing.T) {
	seen := make(map[string]struct{})
	for range 1_000 {
		id, err := randomSessionID()
		if err != nil || !protocol.ValidSessionID(id) {
			t.Fatalf("generated session ID %q: %v", id, err)
		}
		if _, duplicate := seen[id]; duplicate {
			t.Fatalf("duplicate generated session ID %q", id)
		}
		seen[id] = struct{}{}
	}

	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, active: map[string]*managedSession{"abcd-efgh-jkmn": {id: "abcd-efgh-jkmn"}}}
	registry.newSessionID = func() (string, error) { return "abcd-efgh-jkmn", nil }
	owner := testRegistryOwner("30000000-0000-4000-8000-000000000091")
	if _, err := registry.open(owner, protocol.Dimensions{Columns: 80, Rows: 24}); err == nil {
		t.Fatal("collision exhaustion unexpectedly opened a terminal")
	}
	adapter.mu.Lock()
	opens := len(adapter.sessions)
	adapter.mu.Unlock()
	if opens != 0 {
		t.Fatalf("terminal opens after ID collision exhaustion = %d", opens)
	}
}

func TestHistoryBudgetsEvictOldestBytesWithoutClosingSessions(t *testing.T) {
	registry := sessionRegistry{active: make(map[string]*managedSession)}
	sessions := make([]*managedSession, 0, 65)
	for index := range 65 {
		id, err := randomSessionID()
		if err != nil {
			t.Fatal(err)
		}
		managed := &managedSession{id: id, closeDone: make(chan struct{})}
		registry.active[id] = managed
		sessions = append(sessions, managed)
		if index < 64 {
			for range protocol.MaxSessionHistory / protocol.MaxTerminalOutput {
				if _, ok := registry.appendHistoryLocked(managed, make([]byte, protocol.MaxTerminalOutput)); !ok {
					t.Fatal("history append failed")
				}
			}
		}
	}
	if _, ok := registry.appendHistoryLocked(sessions[64], []byte{1}); !ok {
		t.Fatal("newest history append failed")
	}
	oldest := sessions[0]
	if registry.historyBytes != protocol.MaxAgentHistory || oldest.historyBytes != protocol.MaxSessionHistory-1 || oldest.history.Front().Value.(*historyEntry).offset != 1 || sessions[64].historyBytes != 1 {
		t.Fatalf("global eviction bytes=%d oldest=%d/%d newest=%d", registry.historyBytes, oldest.history.Front().Value.(*historyEntry).offset, oldest.historyBytes, sessions[64].historyBytes)
	}
	if len(registry.active) != 65 {
		t.Fatalf("global history pressure closed sessions: active=%d", len(registry.active))
	}
	for _, managed := range sessions {
		if managed.closed {
			t.Fatalf("history pressure closed session %s", managed.id)
		}
		registry.removeHistoryLocked(managed)
	}
	if registry.historyBytes != 0 {
		t.Fatalf("history cleanup bytes = %d", registry.historyBytes)
	}
}

func TestAtomicReopenRequiresCredentialAndSourceDevice(t *testing.T) {
	session := &fakeSession{output: make(chan []byte, 1), closed: make(chan struct{})}
	registry := sessionRegistry{active: make(map[string]*managedSession), revokedCredentials: make(map[string]struct{})}
	managed := &managedSession{
		id: "abcd-efgh-jkmn", credentialID: "30000000-0000-4000-8000-000000000092", deviceIdentity: "device-1",
		terminal: session, cancel: func() {}, detached: true, closeDone: make(chan struct{}),
	}
	registry.active[managed.id] = managed
	dimensions := protocol.Dimensions{Columns: 80, Rows: 24}

	unknownOwner := testRegistryOwner(managed.credentialID)
	_, unknown := registry.beginReopen(unknownOwner, "rstv-wxyz-2345", dimensions)
	wrongCredential := testRegistryOwner("30000000-0000-4000-8000-000000000093")
	_, wrongCredentialErr := registry.beginReopen(wrongCredential, managed.id, dimensions)
	wrongDevice := testRegistryOwner(managed.credentialID)
	wrongDevice.device = "device-2"
	_, wrongDeviceErr := registry.beginReopen(wrongDevice, managed.id, dimensions)
	missingDevice := testRegistryOwner(managed.credentialID)
	missingDevice.device = ""
	_, missingDeviceErr := registry.beginReopen(missingDevice, managed.id, dimensions)
	for label, err := range map[string]error{"unknown": unknown, "credential": wrongCredentialErr, "device": wrongDeviceErr, "missing": missingDeviceErr} {
		if err == nil || err.Error() != "session reopen rejected" {
			t.Fatalf("%s denial = %v", label, err)
		}
	}

	owners := []*connection{testRegistryOwner(managed.credentialID), testRegistryOwner(managed.credentialID)}
	start := make(chan struct{})
	results := make(chan struct {
		owner    *connection
		snapshot reopenSnapshot
		err      error
	}, len(owners))
	for _, owner := range owners {
		go func(owner *connection) {
			<-start
			snapshot, err := registry.beginReopen(owner, managed.id, dimensions)
			results <- struct {
				owner    *connection
				snapshot reopenSnapshot
				err      error
			}{owner: owner, snapshot: snapshot, err: err}
		}(owner)
	}
	close(start)
	winners := 0
	var winner struct {
		owner    *connection
		snapshot reopenSnapshot
	}
	for range owners {
		result := <-results
		if result.err == nil {
			winners++
			winner.owner, winner.snapshot = result.owner, result.snapshot
		} else if result.err.Error() != "session reopen rejected" {
			t.Fatalf("concurrent denial = %v", result.err)
		}
	}
	if winners != 1 {
		t.Fatalf("atomic reopen winners = %d", winners)
	}
	registry.releaseReopen(winner.owner, winner.snapshot.managed)
	if err := registry.closeManaged(managed, "user_request"); err != nil {
		t.Fatal(err)
	}
}

func TestReplayBackpressureReturnsRunningSessionToDetached(t *testing.T) {
	session := &fakeSession{output: make(chan []byte, 1), closed: make(chan struct{})}
	registry := sessionRegistry{active: make(map[string]*managedSession), revokedCredentials: make(map[string]struct{})}
	managed := &managedSession{
		id: "abcd-efgh-jkmn", credentialID: "30000000-0000-4000-8000-000000000094", deviceIdentity: "device-1",
		terminal: session, cancel: func() {}, detached: true, closeDone: make(chan struct{}),
	}
	registry.active[managed.id] = managed
	registry.appendHistoryLocked(managed, []byte("bounded-history"))
	owner := testRegistryOwner(managed.credentialID)
	owner.id = "10000000-0000-4000-8000-000000000094"
	owner.writes = make(chan outbound)
	request, err := protocol.NewFrame("reopen_session", owner.id, 0, protocol.ReopenSessionPayload{SessionID: managed.id, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	if err != nil {
		t.Fatal(err)
	}
	decoded := protocol.DecodedFrame{Frame: request, Value: &protocol.ReopenSessionPayload{SessionID: managed.id, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}}}
	if err := owner.machine.Apply(protocol.ClientToAgent, decoded); err != nil {
		t.Fatal(err)
	}
	snapshot, err := registry.beginReopen(owner, managed.id, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	err = registry.replay(owner, snapshot)
	if code, _, ok := protocol.ErrorDetails(err); !ok || code != protocol.BackpressureLimit {
		t.Fatalf("replay backpressure = %v (%s)", err, code)
	}
	registry.mu.Lock()
	detached := registry.active[managed.id] == managed && managed.detached && managed.owner == nil && !managed.closed
	registry.mu.Unlock()
	if !detached {
		t.Fatal("replay backpressure did not preserve a detached running session")
	}
	select {
	case <-session.closed:
		t.Fatal("replay backpressure closed the terminal")
	default:
	}
	if err := registry.closeManaged(managed, "user_request"); err != nil {
		t.Fatal(err)
	}
}

func TestReplaySnapshotBarrierPrecedesResizeOutput(t *testing.T) {
	fake := &fakeSession{output: make(chan []byte, 4), closed: make(chan struct{})}
	session := &resizeOutputSession{fakeSession: fake, outputOnResize: []byte("after-snapshot")}
	adapter := &resizeOutputAdapter{session: session}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "barrier-device", nil }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	fake.output <- []byte("snapshot")
	client.read("terminal_output")
	client.send("detach", protocol.SessionIDPayload{SessionID: sessionID})
	client.read("session_detached")
	_ = client.ws.Close()

	reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000095")
	reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	reopened.read("session_reopened")
	begin := reopened.read("history_begin").Value.(*protocol.HistoryBeginPayload)
	chunk := reopened.read("history_chunk").Value.(*protocol.HistoryChunkPayload)
	history, _ := protocol.DecodeBase64(chunk.Data, -1)
	if string(history) != "snapshot" || begin.EndOffset != uint64(len(history)) {
		t.Fatalf("snapshot history = %q begin=%+v", history, begin)
	}
	reopened.read("history_end")
	live := reopened.read("terminal_output").Value.(*protocol.TerminalOutputPayload)
	liveBytes, _ := protocol.DecodeBase64(live.Data, -1)
	if string(liveBytes) != "after-snapshot" || live.Offset != begin.EndOffset {
		t.Fatalf("post-barrier output = %q offset=%d want=%d", liveBytes, live.Offset, begin.EndOffset)
	}
	reopened.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "user_request"})
	reopened.read("session_closed")
}

func TestDetachedHistoryTruncationAndRevocationCleanup(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	client.send("detach", protocol.SessionIDPayload{SessionID: sessionID})
	client.read("session_detached")
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	for range protocol.MaxSessionHistory / protocol.MaxTerminalOutput {
		session.output <- make([]byte, protocol.MaxTerminalOutput)
	}
	session.output <- []byte{1}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		endpoint.sessions.mu.Lock()
		managed := endpoint.sessions.active[sessionID]
		ready := managed != nil && managed.nextOffset == protocol.MaxSessionHistory+1 && managed.historyBytes == protocol.MaxSessionHistory
		endpoint.sessions.mu.Unlock()
		if ready {
			break
		}
		time.Sleep(time.Millisecond)
	}
	reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000096")
	reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	reopened.read("session_reopened")
	begin := reopened.read("history_begin").Value.(*protocol.HistoryBeginPayload)
	if begin.StartOffset != 1 || begin.EndOffset != protocol.MaxSessionHistory+1 || !begin.Truncated {
		t.Fatalf("truncated begin = %+v", begin)
	}
	remaining := begin.EndOffset - begin.StartOffset
	for remaining > 0 {
		chunk := reopened.read("history_chunk").Value.(*protocol.HistoryChunkPayload)
		data, _ := protocol.DecodeBase64(chunk.Data, -1)
		remaining -= uint64(len(data))
	}
	reopened.read("history_end")
	if err := endpoint.RevokeCredential(context.Background(), credential.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case <-session.closed:
	case <-time.After(time.Second):
		t.Fatal("revocation did not close reopened terminal")
	}
	endpoint.sessions.mu.Lock()
	active, historyBytes := len(endpoint.sessions.active), endpoint.sessions.historyBytes
	endpoint.sessions.mu.Unlock()
	if active != 0 || historyBytes != 0 {
		t.Fatalf("revocation cleanup active=%d history=%d", active, historyBytes)
	}
}

func TestHandshakeOriginProtocolAndTLSRejections(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	for _, item := range []struct {
		name, origin, subprotocol string
		status                    int
	}{{"origin", "https://attacker.invalid", protocol.Subprotocol, 403}, {"missing-origin", "", protocol.Subprotocol, 403}, {"subprotocol", testOrigin, "other.v1", 426}, {"old-subprotocol", testOrigin, "terminus.v0_1", 426}} {
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

func TestAuthorizationExpiryDetachesRunningSession(t *testing.T) {
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
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	nanos.Store(base.Add(13 * time.Hour).UnixNano())
	client.send("heartbeat", protocol.HeartbeatPayload{Kind: "ping", Nonce: protocol.EncodeBase64(make([]byte, 16))})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthorizationExpired {
		t.Fatalf("code = %s", got)
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		endpoint.sessions.mu.Lock()
		managed := endpoint.sessions.active[sessionID]
		detached := managed != nil && managed.detached && managed.owner == nil
		endpoint.sessions.mu.Unlock()
		if detached {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("authorization expiry did not detach the running session")
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
	if got := client.read("session_closed").Value.(*protocol.SessionClosedPayload).Reason; got != "credential_expired" {
		t.Fatalf("close reason = %s", got)
	}
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

func TestCredentialExpiryClosesDetachedSessionAndHistory(t *testing.T) {
	endpoint, adapter, store := newTestEndpoint(t)
	credential := Credential{ID: "30000000-0000-4000-8000-000000000051", ExpiresAt: time.Now().Add(800 * time.Millisecond)}
	for index := range credential.Secret {
		credential.Secret[index] = byte(index)
	}
	if err := store.Put(context.Background(), credential); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()
	client := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000051")
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	client.send("detach", protocol.SessionIDPayload{SessionID: sessionID})
	client.read("session_detached")
	adapter.mu.Lock()
	session := adapter.sessions[0]
	adapter.mu.Unlock()
	session.output <- []byte("volatile-only")
	select {
	case <-session.closed:
	case <-time.After(2 * time.Second):
		t.Fatal("credential expiry left detached terminal active")
	}
	endpoint.sessions.mu.Lock()
	active, historyBytes := len(endpoint.sessions.active), endpoint.sessions.historyBytes
	endpoint.sessions.mu.Unlock()
	if active != 0 || historyBytes != 0 {
		t.Fatalf("credential expiry cleanup active=%d history=%d", active, historyBytes)
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

func TestRejectedReopenRateLimitUsesTwentyAttemptWindow(t *testing.T) {
	limiter := newRateLimiter(20)
	now := time.Now()
	for attempt := range 20 {
		if !limiter.begin("credential\x00device", now) {
			t.Fatalf("reopen attempt %d rejected before limit", attempt+1)
		}
		limiter.finish("credential\x00device", now, false)
	}
	if limiter.begin("credential\x00device", now) || limiter.allowed("credential\x00device", now) {
		t.Fatal("twenty rejected reopens did not start cooldown")
	}
	if !limiter.allowed("credential\x00device", now.Add(5*time.Minute+time.Millisecond)) {
		t.Fatal("reopen cooldown did not expire")
	}
}

func TestConnectionIDCannotBeReused(t *testing.T) {
	endpoint, _, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	id := "10000000-0000-4000-8000-000000000060"
	firstWS, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	first := &testClient{t: t, ws: firstWS, id: id}
	first.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	first.read("hello_ack")
	secondWS, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	second := &testClient{t: t, ws: secondWS, id: id}
	second.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	if got := second.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.InvalidState {
		t.Fatalf("code = %s", got)
	}
	firstWS.Close()
	secondWS.Close()
}

func TestCredentialRevocationClosesAllAuthorizationsAndSessions(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	first, credential := pairAndAuthorize(t, endpoint, server)
	second := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000079")
	clients := []*testClient{first, second}
	for _, client := range clients {
		client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
		client.read("session_opened")
	}
	if err := endpoint.RevokeCredential(context.Background(), credential.ID); err != nil {
		t.Fatal(err)
	}
	adapter.mu.Lock()
	sessions := append([]*fakeSession(nil), adapter.sessions...)
	adapter.mu.Unlock()
	for index, session := range sessions {
		select {
		case <-session.closed:
		case <-time.After(time.Second):
			t.Fatalf("revocation left terminal %d open", index)
		}
	}
	for _, client := range clients {
		if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
			t.Fatalf("code = %s", got)
		}
	}
}

func TestCredentialRevocationSendsAuthenticationFailureBeforeBlockingTerminalClose(t *testing.T) {
	inner := &fakeSession{output: make(chan []byte, 4), closed: make(chan struct{})}
	blocking := &blockingCloseSession{fakeSession: inner, closeStarted: make(chan struct{}), releaseClose: make(chan struct{})}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{
		AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: &blockingCloseAdapter{session: blocking}, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "blocked-revocation-device", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	client.read("session_opened")

	revokeDone := make(chan error, 1)
	go func() { revokeDone <- endpoint.RevokeCredential(context.Background(), credential.ID) }()
	select {
	case <-blocking.closeStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("credential revocation did not reach terminal cleanup")
	}
	if err := client.ws.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.AuthenticationFailed {
		t.Fatalf("code = %s, want %s", got, protocol.AuthenticationFailed)
	}
	select {
	case err := <-revokeDone:
		t.Fatalf("revocation returned before blocked terminal cleanup was released: %v", err)
	default:
	}
	close(blocking.releaseClose)
	if err := awaitTestError(t, "credential revocation cleanup", revokeDone); err != nil {
		t.Fatal(err)
	}
}

func TestReplayStopsAtCloseFenceWhileTerminalCleanupIsBlocked(t *testing.T) {
	tests := []struct {
		name    string
		trigger func(*sessionRegistry, *managedSession, *blockingCloseSession) <-chan error
	}{
		{
			name: "credential revocation",
			trigger: func(registry *sessionRegistry, managed *managedSession, _ *blockingCloseSession) <-chan error {
				result := make(chan error, 1)
				go func() { result <- registry.revokeCredential(managed.credentialID) }()
				return result
			},
		},
		{
			name: "process exit",
			trigger: func(_ *sessionRegistry, managed *managedSession, blocking *blockingCloseSession) <-chan error {
				result := make(chan error, 1)
				go func() {
					blocking.fakeSession.once.Do(func() { close(blocking.fakeSession.closed) })
					<-managed.closeDone
					result <- managed.closeErr
				}()
				return result
			},
		},
		{
			name: "agent shutdown",
			trigger: func(registry *sessionRegistry, _ *managedSession, _ *blockingCloseSession) <-chan error {
				result := make(chan error, 1)
				go func() { result <- registry.shutdown() }()
				return result
			},
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			inner := &fakeSession{output: make(chan []byte, 4), closed: make(chan struct{})}
			blocking := &blockingCloseSession{fakeSession: inner, closeStarted: make(chan struct{}), releaseClose: make(chan struct{})}
			registry := sessionRegistry{adapter: &blockingCloseAdapter{session: blocking}, now: time.Now}
			credentialID := fmt.Sprintf("30000000-0000-4000-8000-%012d", 600+index)
			firstOwner := testRegistryOwner(credentialID)
			id, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24})
			if err != nil {
				t.Fatal(err)
			}
			if err := registry.detach(firstOwner, id); err != nil {
				t.Fatal(err)
			}
			inner.output <- []byte("first-history-frame")
			inner.output <- []byte("second-history-frame")
			deadline := time.Now().Add(3 * time.Second)
			for {
				registry.mu.Lock()
				managed := registry.active[id]
				ready := managed != nil && managed.history.Len() == 2
				registry.mu.Unlock()
				if ready {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("terminal output did not reach the replay history")
				}
				time.Sleep(time.Millisecond)
			}
			reopener := testRegistryOwner(credentialID)
			reopener.id = fmt.Sprintf("10000000-0000-4000-8000-%012d", 600+index)
			reopener.machine = protocol.NewMachine(protocol.ConnectionReady, protocol.SessionReopening, 0, 0)
			reopener.writes = make(chan outbound)
			snapshot, err := registry.beginReopen(reopener, id, protocol.Dimensions{Columns: 80, Rows: 24})
			if err != nil {
				t.Fatal(err)
			}
			replayDone := make(chan error, 1)
			go func() { replayDone <- registry.replay(reopener, snapshot) }()
			var blockedChunk outbound
			for _, want := range []string{"session_reopened", "history_begin", "history_chunk"} {
				select {
				case item := <-reopener.writes:
					if item.frame.Type != want {
						t.Fatalf("replay frame = %s, want %s", item.frame.Type, want)
					}
					if want == "history_chunk" {
						blockedChunk = item
					} else {
						item.result <- nil
					}
				case <-time.After(3 * time.Second):
					t.Fatalf("replay did not emit %s", want)
				}
			}
			closeDone := test.trigger(&registry, snapshot.managed, blocking)
			select {
			case <-blocking.closeStarted:
			case <-time.After(3 * time.Second):
				t.Fatal("terminal cleanup did not reach the blocking close")
			}
			blockedChunk.result <- nil
			if err := awaitTestError(t, "fenced replay", replayDone); err == nil {
				t.Fatal("replay completed after its session was fenced closed")
			}
			select {
			case item := <-reopener.writes:
				t.Fatalf("replay emitted %s after the close fence", item.frame.Type)
			default:
			}
			close(blocking.releaseClose)
			if err := awaitTestError(t, "blocked terminal cleanup", closeDone); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestCredentialRevocationWinsAgainstStalledOpenAndClosesLateTerminal(t *testing.T) {
	adapter := newLateTerminalAfterCancellationAdapter()
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{
		AllowedOrigin:  testOrigin,
		AgentID:        testAgentID,
		Terminal:       adapter,
		Credentials:    store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true },
		ResolveDevice:  func(*http.Request) (string, error) { return "stalled-open-revocation-device", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()

	client, credential := pairAndAuthorize(t, endpoint, server)
	defer client.ws.Close()
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	select {
	case <-adapter.started:
	case <-time.After(3 * time.Second):
		t.Fatal("terminal creation did not reach the stalled adapter")
	}

	revokeDone := make(chan error, 1)
	go func() { revokeDone <- endpoint.RevokeCredential(context.Background(), credential.ID) }()
	if err := awaitTestError(t, "credential revocation during stalled open", revokeDone); err != nil {
		t.Fatal(err)
	}

	if err := client.ws.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	failure := client.read("error").Value.(*protocol.ErrorPayload)
	if failure.Code != protocol.AuthenticationFailed {
		t.Fatalf("revocation error = %s, want %s (and not %s)", failure.Code, protocol.AuthenticationFailed, protocol.SessionOpenFailed)
	}
	if !failure.Fatal {
		t.Fatal("revocation error was not fatal")
	}

	select {
	case <-adapter.cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("connection shutdown did not cancel the pending terminal open")
	}
	var late *fakeSession
	select {
	case late = <-adapter.created:
	case <-time.After(3 * time.Second):
		t.Fatal("adapter did not return its late terminal")
	}
	requireTestSessionClosed(t, "revocation revalidation", late)
	endpoint.sessions.mu.Lock()
	active, pending := len(endpoint.sessions.active), len(endpoint.sessions.pending)
	endpoint.sessions.mu.Unlock()
	if active != 0 || pending != 0 {
		t.Fatalf("revoked admission accounting: active=%d pending=%d", active, pending)
	}
}

func TestSessionRegistryRejectsClosedConnectionBeforeProcessCreation(t *testing.T) {
	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	done := make(chan struct{})
	close(done)
	owner := &connection{done: done, credential: Credential{ID: "30000000-0000-4000-8000-000000000079"}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
	if _, err := registry.open(owner, protocol.Dimensions{Columns: 80, Rows: 24}); err == nil {
		t.Fatal("closed connection opened a terminal session")
	}
	adapter.mu.Lock()
	created := len(adapter.sessions)
	adapter.mu.Unlock()
	if created != 0 {
		t.Fatalf("closed connection created %d terminal sessions", created)
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
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: credential.ID, SupportedVersions: []string{protocol.Version}})
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

func TestEndpointShutdownRejectsOpenWhileCleanupInProgressAndReturnsCleanupError(t *testing.T) {
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
	unsupported.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{"9.9"}})
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
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
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
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	client.read("hello_ack")
	wrong := protocol.EncodeBase64(make([]byte, 16))
	client.send("pairing_request", protocol.PairingRequestPayload{PairingCode: wrong})
	client.read("error")
	ws.Close()
	ws2, _, _ := dial(t, server, testOrigin, protocol.Subprotocol)
	c2 := &testClient{t: t, ws: ws2, id: "10000000-0000-4000-8000-000000000011"}
	c2.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	c2.read("hello_ack")
	c2.send("pairing_request", protocol.PairingRequestPayload{PairingCode: code})
	frame := c2.read("error")
	if frame.Value.(*protocol.ErrorPayload).Code != protocol.PairingFailed {
		t.Fatal("pairing code was not consumed")
	}
	ws2.Close()
	if _, err := protocol.Decode(append([]byte(`{"version":"0.2"}`), bytes.Repeat([]byte(" "), protocol.MaxWireBytes)...)); errorCode(err) != protocol.FrameTooLarge {
		t.Fatal("oversize frame accepted")
	}
	machine := protocol.NewMachine(protocol.ConnectionNew, protocol.SessionNone, 0, 0)
	hello, _ := protocol.NewFrame("hello", "10000000-0000-4000-8000-000000000012", 0, protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
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
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
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
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: credential.ID, SupportedVersions: []string{protocol.Version}})
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
	replay.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
	replay.read("hello_ack")
	duplicate, _ := protocol.NewFrame("hello", replay.id, 0, protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}})
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

func TestEndpointAllowsIndependentSessionsAboveLegacyBoundary(t *testing.T) {
	endpoint, adapter, _ := newTestEndpoint(t)
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()

	const sessionCount = 12
	first, credential := pairAndAuthorize(t, endpoint, server)
	clients := []*testClient{first}
	for index := 2; index <= sessionCount; index++ {
		connectionID := fmt.Sprintf("10000000-0000-4000-8000-%012d", index)
		clients = append(clients, authorizeExisting(t, server, credential, connectionID))
	}
	sessionIDs := make([]string, 0, len(clients))
	for _, client := range clients {
		client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
		sessionIDs = append(sessionIDs, client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID)
	}

	adapter.mu.Lock()
	created := len(adapter.sessions)
	sessions := append([]*fakeSession(nil), adapter.sessions...)
	adapter.mu.Unlock()
	if created != sessionCount {
		t.Fatalf("created sessions = %d, want %d", created, sessionCount)
	}

	firstID := sessionIDs[0]
	lastID := sessionIDs[len(sessionIDs)-1]
	first.send("terminal_input", protocol.TerminalPayload{SessionID: firstID, Data: protocol.EncodeBase64([]byte("first"))})
	clients[len(clients)-1].send("terminal_input", protocol.TerminalPayload{SessionID: lastID, Data: protocol.EncodeBase64([]byte("last"))})
	first.send("resize", protocol.ResizePayload{SessionID: firstID, Dimensions: protocol.Dimensions{Columns: 101, Rows: 31}})
	clients[len(clients)-1].send("resize", protocol.ResizePayload{SessionID: lastID, Dimensions: protocol.Dimensions{Columns: 112, Rows: 42}})
	waitSessionState(t, sessions[0], "first", 101, 31)
	waitSessionState(t, sessions[len(sessions)-1], "last", 112, 42)

	first.send("close_session", protocol.CloseSessionPayload{SessionID: firstID, Reason: "user_request"})
	first.read("session_closed")
}

func TestSessionRegistryConcurrentAdmissionHasNoFixedCountLimit(t *testing.T) {
	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	const attempts = 24
	results := make(chan error, attempts)
	for index := 0; index < attempts; index++ {
		index := index
		go func() {
			owner := &connection{credential: Credential{ID: fmt.Sprintf("30000000-0000-4000-8000-%012d", index+1)}, machine: protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0)}
			_, err := registry.open(owner, protocol.Dimensions{Columns: 80, Rows: 24})
			results <- err
		}()
	}
	for index := 0; index < attempts; index++ {
		if err := <-results; err != nil {
			t.Fatalf("concurrent open %d failed: %v", index, err)
		}
	}
	adapter.mu.Lock()
	created := len(adapter.sessions)
	adapter.mu.Unlock()
	if created != attempts {
		t.Fatalf("created sessions = %d, want %d", created, attempts)
	}
	if err := registry.close("agent_shutdown"); err != nil {
		t.Fatal(err)
	}
}

func TestStalledOpenDoesNotBlockUnrelatedSessionLifecycle(t *testing.T) {
	tests := []struct {
		name      string
		operation func(*sessionRegistry, *connection, string) error
		verify    func(*testing.T, *fakeSession)
	}{
		{
			name: "input",
			operation: func(registry *sessionRegistry, owner *connection, id string) error {
				return registry.input(owner, id, []byte{0})
			},
			verify: func(t *testing.T, session *fakeSession) {
				session.mu.Lock()
				length := session.input.Len()
				session.mu.Unlock()
				if length != 1 {
					t.Fatalf("input length = %d, want 1", length)
				}
			},
		},
		{
			name: "resize",
			operation: func(registry *sessionRegistry, owner *connection, id string) error {
				return registry.resize(owner, id, protocol.Dimensions{Columns: 101, Rows: 31})
			},
			verify: func(t *testing.T, session *fakeSession) {
				session.mu.Lock()
				columns, rows := session.columns, session.rows
				session.mu.Unlock()
				if columns != 101 || rows != 31 {
					t.Fatalf("dimensions = %dx%d, want 101x31", columns, rows)
				}
			},
		},
		{
			name: "close",
			operation: func(registry *sessionRegistry, owner *connection, id string) error {
				return registry.closeBy(owner, id, "user_request")
			},
			verify: func(t *testing.T, session *fakeSession) {
				requireTestSessionClosed(t, "close", session)
			},
		},
		{
			name: "disconnect cleanup",
			operation: func(registry *sessionRegistry, owner *connection, _ string) error {
				registry.disconnected(owner, true)
				return nil
			},
			verify: func(t *testing.T, session *fakeSession) {
				requireTestSessionClosed(t, "disconnect cleanup", session)
			},
		},
		{
			name: "credential revocation",
			operation: func(registry *sessionRegistry, owner *connection, _ string) error {
				return registry.revokeCredential(owner.credentialID())
			},
			verify: func(t *testing.T, session *fakeSession) {
				requireTestSessionClosed(t, "credential revocation", session)
			},
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter := newIgnoringContextOpenAdapter(2, 1)
			t.Cleanup(adapter.unblock)
			registry := sessionRegistry{adapter: adapter, now: time.Now}
			firstOwner := testRegistryOwner(fmt.Sprintf("30000000-0000-4000-8000-%012d", 200+index))
			secondOwner := testRegistryOwner(fmt.Sprintf("30000000-0000-4000-8000-%012d", 300+index))
			firstID, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24})
			if err != nil {
				t.Fatal(err)
			}
			firstSession := adapter.snapshot()[0]

			openDone := make(chan error, 1)
			go func() {
				_, openErr := registry.open(secondOwner, protocol.Dimensions{Columns: 80, Rows: 24})
				openDone <- openErr
			}()
			select {
			case <-adapter.started:
			case <-time.After(3 * time.Second):
				t.Fatal("second terminal creation did not reach the adapter")
			}

			operationDone := make(chan error, 1)
			go func() { operationDone <- test.operation(&registry, firstOwner, firstID) }()
			if err := awaitTestError(t, test.name, operationDone); err != nil {
				t.Fatal(err)
			}
			test.verify(t, firstSession)

			adapter.unblock()
			if err := awaitTestError(t, "stalled terminal creation", openDone); err != nil {
				t.Fatal(err)
			}
			if err := registry.shutdown(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStalledOpenDoesNotBlockShutdownAndLateTerminalIsClosed(t *testing.T) {
	adapter := newIgnoringContextOpenAdapter(2, 1)
	t.Cleanup(adapter.unblock)
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	firstOwner := testRegistryOwner("30000000-0000-4000-8000-000000000401")
	secondOwner := testRegistryOwner("30000000-0000-4000-8000-000000000402")
	if _, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	firstSession := adapter.snapshot()[0]
	openDone := make(chan error, 1)
	go func() {
		_, err := registry.open(secondOwner, protocol.Dimensions{Columns: 80, Rows: 24})
		openDone <- err
	}()
	select {
	case <-adapter.started:
	case <-time.After(3 * time.Second):
		t.Fatal("second terminal creation did not reach the adapter")
	}

	shutdownDone := make(chan error, 1)
	go func() { shutdownDone <- registry.shutdown() }()
	if err := awaitTestError(t, "shutdown", shutdownDone); err != nil {
		t.Fatal(err)
	}
	requireTestSessionClosed(t, "shutdown", firstSession)

	adapter.unblock()
	if err := awaitTestError(t, "late terminal creation", openDone); err == nil {
		t.Fatal("terminal created after shutdown was admitted")
	}
	sessions := adapter.snapshot()
	if len(sessions) != 2 {
		t.Fatalf("created sessions = %d, want 2", len(sessions))
	}
	requireTestSessionClosed(t, "shutdown revalidation", sessions[1])
	registry.mu.Lock()
	active, pending := len(registry.active), len(registry.pending)
	registry.mu.Unlock()
	if active != 0 || pending != 0 {
		t.Fatalf("shutdown accounting: active=%d pending=%d", active, pending)
	}
}

func TestLateTerminalIsClosedAfterOwnerOrCredentialInvalidation(t *testing.T) {
	tests := []struct {
		name       string
		invalidate func(*sessionRegistry, *connection) error
	}{
		{
			name: "owner disconnect",
			invalidate: func(registry *sessionRegistry, owner *connection) error {
				close(owner.done)
				registry.disconnected(owner)
				return nil
			},
		},
		{
			name: "credential revocation",
			invalidate: func(registry *sessionRegistry, owner *connection) error {
				return registry.revokeCredential(owner.credentialID())
			},
		},
	}

	for index, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter := newIgnoringContextOpenAdapter(1, 1)
			t.Cleanup(adapter.unblock)
			registry := sessionRegistry{adapter: adapter, now: time.Now}
			owner := testRegistryOwner(fmt.Sprintf("30000000-0000-4000-8000-%012d", 500+index))
			openDone := make(chan error, 1)
			go func() {
				_, err := registry.open(owner, protocol.Dimensions{Columns: 80, Rows: 24})
				openDone <- err
			}()
			select {
			case <-adapter.started:
			case <-time.After(3 * time.Second):
				t.Fatal("terminal creation did not reach the adapter")
			}

			invalidateDone := make(chan error, 1)
			go func() { invalidateDone <- test.invalidate(&registry, owner) }()
			if err := awaitTestError(t, test.name, invalidateDone); err != nil {
				t.Fatal(err)
			}
			adapter.unblock()
			if err := awaitTestError(t, "invalidated terminal creation", openDone); err == nil {
				t.Fatal("terminal created after admission invalidation was admitted")
			}
			sessions := adapter.snapshot()
			if len(sessions) != 1 {
				t.Fatalf("created sessions = %d, want 1", len(sessions))
			}
			requireTestSessionClosed(t, test.name, sessions[0])
			registry.mu.Lock()
			active, pending := len(registry.active), len(registry.pending)
			registry.mu.Unlock()
			if active != 0 || pending != 0 {
				t.Fatalf("invalidated admission accounting: active=%d pending=%d", active, pending)
			}
		})
	}
}

func TestConcurrentStalledAdmissionsHaveNoFixedCountLimit(t *testing.T) {
	const attempts = 24
	adapter := newIgnoringContextOpenAdapter(1, attempts)
	t.Cleanup(adapter.unblock)
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	results := make(chan error, attempts)
	for index := 0; index < attempts; index++ {
		index := index
		go func() {
			owner := testRegistryOwner(fmt.Sprintf("30000000-0000-4000-8000-%012d", 600+index))
			_, err := registry.open(owner, protocol.Dimensions{Columns: 80, Rows: 24})
			results <- err
		}()
	}
	for index := 0; index < attempts; index++ {
		select {
		case <-adapter.started:
		case <-time.After(3 * time.Second):
			t.Fatalf("terminal creation %d of %d did not reach the adapter", index+1, attempts)
		}
	}
	adapter.unblock()
	for index := 0; index < attempts; index++ {
		if err := awaitTestError(t, "concurrent terminal creation", results); err != nil {
			t.Fatalf("concurrent open %d failed: %v", index, err)
		}
	}
	registry.mu.Lock()
	active, pending := len(registry.active), len(registry.pending)
	registry.mu.Unlock()
	if active != attempts || pending != 0 {
		t.Fatalf("admission accounting: active=%d pending=%d, want %d/0", active, pending, attempts)
	}
	if created := len(adapter.snapshot()); created != attempts {
		t.Fatalf("created sessions = %d, want %d", created, attempts)
	}
	if err := registry.shutdown(); err != nil {
		t.Fatal(err)
	}
}

func TestEndpointReportsActualAdapterOpenFailure(t *testing.T) {
	sentinel := errors.New("synthetic adapter open failure")
	endpoint, err := New(Config{
		AllowedOrigin:  testOrigin,
		AgentID:        testAgentID,
		Terminal:       failingOpenAdapter{err: sentinel},
		Credentials:    newMemoryCredentialStore(),
		ApprovePairing: func(context.Context, PairingApproval) bool { return true },
		ResolveDevice:  func(*http.Request) (string, error) { return "open-failure-device", nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()
	defer endpoint.Close()

	client, _ := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	if got := client.read("error").Value.(*protocol.ErrorPayload).Code; got != protocol.SessionOpenFailed {
		t.Fatalf("adapter open error = %s, want %s", got, protocol.SessionOpenFailed)
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
	if proof != "loDDHqUw_0yYrBFNf9-3WqETNRyemfXDwj0ooSubU2w" {
		t.Fatalf("proof = %s", proof)
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
	for _, forbidden := range []string{"input-marker", "history-marker", "credentialSecret", "challenge"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("log contained %q", forbidden)
		}
	}
}

func errorCode(err error) protocol.ErrorCode { code, _, _ := protocol.ErrorDetails(err); return code }
