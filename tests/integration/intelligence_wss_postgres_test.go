// Package integration_test joins immutable production endpoint/service code.
// Copy into an isolated apps/windows-agent/internal/s06integration directory.
// Credentials/device resolver and TLS certificate are synthetic test boundaries.
package integration_test

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"terminus/windows-agent/internal/endpoint"
	"terminus/windows-agent/internal/intelligence"
	"terminus/windows-agent/internal/terminal"
)

const testOrigin = "https://s06.example.invalid"
const testDevice = "synthetic-s06-device"

type memoryStore struct {
	mu     sync.Mutex
	values map[string]endpoint.Credential
}

func (s *memoryStore) Put(_ context.Context, c endpoint.Credential) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.values[c.ID] = c
	return nil
}
func (s *memoryStore) Get(_ context.Context, id string) (endpoint.Credential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	c, ok := s.values[id]
	if !ok {
		return c, errors.New("missing test credential")
	}
	return c, nil
}
func (s *memoryStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.values, id)
	return nil
}
func id() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("test random unavailable")
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func credential(t *testing.T) endpoint.Credential {
	t.Helper()
	c := endpoint.Credential{ID: id(), ExpiresAt: time.Now().Add(time.Hour), DeviceIdentity: testDevice}
	if _, err := rand.Read(c.Secret[:]); err != nil {
		t.Fatal("test random unavailable")
	}
	return c
}

type response struct {
	Type  string          `json:"type"`
	ID    string          `json:"id"`
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}
type peer struct {
	t  *testing.T
	ws *websocket.Conn
}

func (p peer) call(method string, params any, want string) json.RawMessage {
	p.t.Helper()
	requestID := id()
	p.ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if p.ws.WriteJSON(map[string]any{"type": "request", "id": requestID, "method": method, "params": params}) != nil {
		p.t.Fatal("RPC write failed")
	}
	p.ws.SetReadDeadline(time.Now().Add(12 * time.Second))
	var result response
	if p.ws.ReadJSON(&result) != nil {
		p.t.Fatal("RPC read failed")
	}
	if result.Type != "result" || result.ID != requestID || result.OK != (want == "") || result.Error != want {
		p.t.Fatalf("RPC %s status did not match expected %s", method, want)
	}
	return result.Data
}
func parse[T any](t *testing.T, raw []byte) T {
	t.Helper()
	var v T
	if json.Unmarshal(raw, &v) != nil {
		t.Fatal("RPC data shape invalid")
	}
	return v
}
func require(t *testing.T, condition bool, message string) {
	t.Helper()
	if !condition {
		t.Fatal(message)
	}
}

func TestIntelligenceRealWSSServicePostgres(t *testing.T) {
	databaseURL := os.Getenv("TERMINUS_INTELLIGENCE_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Fatal("TERMINUS_INTELLIGENCE_TEST_DATABASE_URL required; test must not silently skip")
	}
	location, err := url.Parse(databaseURL)
	if err != nil || location.Scheme != "postgres" || location.Hostname() != "127.0.0.1" || location.Port() != "55439" || location.Path != "/postgres" || location.User == nil || location.User.Username() != "terminus_intelligence_app" || location.RawQuery != "sslmode=disable" || location.Fragment != "" {
		t.Fatal("explicit disposable loopback database fixture required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	service, err := intelligence.Open(ctx, databaseURL, "", "", "")
	if err != nil {
		t.Fatal("disposable service unavailable")
	}
	defer service.Close()
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal("disposable DB unavailable")
	}
	defer db.Close()
	store := &memoryStore{values: map[string]endpoint.Credential{}}
	a, b := credential(t), credential(t)
	store.Put(ctx, a)
	store.Put(ctx, b)
	ep, err := endpoint.New(endpoint.Config{AllowedOrigin: testOrigin, AgentID: id(), Terminal: terminal.LocalAdapter{}, Credentials: store, ApprovePairing: func(context.Context, endpoint.PairingApproval) bool { return false }, ResolveDevice: func(*http.Request) (string, error) { return testDevice, nil }})
	if err != nil {
		t.Fatal("endpoint unavailable")
	}
	defer ep.Close()
	server := httptest.NewTLSServer(ep.IntelligenceHandler(service))
	defer server.Close()
	// Explicit trust of this test certificate, never InsecureSkipVerify or OS trust changes.
	roots := server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots, MinVersion: tls.VersionTLS13}, Subprotocols: []string{endpoint.IntelligenceSubprotocol}}
	url := "wss" + strings.TrimPrefix(server.URL, "https") + "/intelligence"
	connect := func(c endpoint.Credential, wrongProof bool) peer {
		t.Helper()
		ws, _, err := dialer.Dial(url, http.Header{"Origin": []string{testOrigin}})
		if err != nil {
			t.Fatal("test WSS upgrade failed")
		}
		t.Cleanup(func() { ws.Close() })
		ws.SetReadDeadline(time.Now().Add(5 * time.Second))
		var challenge struct{ Type, ConnectionID, ChallengeID, Challenge string }
		if ws.ReadJSON(&challenge) != nil || challenge.Type != "challenge" {
			t.Fatal("challenge missing")
		}
		nonce, err := base64.RawURLEncoding.DecodeString(challenge.Challenge)
		if err != nil || len(nonce) != 32 {
			t.Fatal("challenge invalid")
		}
		mac := hmac.New(sha256.New, c.Secret[:])
		mac.Write([]byte("Terminus/intelligence/1/auth\x00" + challenge.ConnectionID + "\x00" + challenge.ChallengeID + "\x00"))
		mac.Write(nonce)
		proof := mac.Sum(nil)
		if wrongProof {
			proof[0] ^= 1
		}
		if ws.WriteJSON(map[string]string{"type": "authenticate", "credentialId": c.ID, "proof": base64.RawURLEncoding.EncodeToString(proof)}) != nil {
			t.Fatal("auth write failed")
		}
		var ready struct{ Type string }
		err = ws.ReadJSON(&ready)
		if wrongProof {
			require(t, err != nil, "wrong HMAC authenticated")
			return peer{t, ws}
		}
		require(t, err == nil && ready.Type == "ready", "valid HMAC not authenticated")
		return peer{t, ws}
	}
	// The fully wired service remains protected before and after authentication.
	if ws, resp, err := dialer.Dial(url, http.Header{"Origin": []string{"https://wrong.example.invalid"}}); err == nil {
		ws.Close()
		t.Fatal("wrong Origin accepted")
	} else {
		require(t, resp != nil && resp.StatusCode == 403, "wrong Origin not denied")
	}
	connect(a, true)
	pa, pb := connect(a, false), connect(b, false)
	empty := map[string]any{}
	first := parse[intelligence.Snapshot](t, pa.call("session.current", empty, ""))
	require(t, first.Identity == "guest" && !first.Privacy.History && !first.Privacy.Analytics && !first.Privacy.Personalization, "unsafe initial consent")
	recordID := id()
	record := map[string]string{"eventId": recordID, "command": "git status --synthetic-option=discard-this-argument"}
	pa.call("command.record", record, "CONSENT_REQUIRED")
	var count int
	err = db.QueryRow("SELECT count(*) FROM terminus_intelligence.command_events WHERE event_id=$1", recordID).Scan(&count)
	require(t, err == nil && count == 0, "consent-off persisted event")
	pa.call("privacy.update", map[string]bool{"history": true, "analytics": true, "personalization": true}, "")
	result := parse[struct {
		Recorded bool
		Event    intelligence.CommandEvent
	}](t, pa.call("command.record", record, ""))
	require(t, result.Recorded && result.Event.Command == "git status" && result.Event.Status == "submitted" && result.Event.ExitCode == nil && result.Event.DurationMS == nil, "unsafe serialized record")
	var persisted string
	err = db.QueryRow("SELECT command FROM terminus_intelligence.command_events WHERE event_id=$1", recordID).Scan(&persisted)
	require(t, err == nil && persisted == "git status", "database redaction missing")
	replay := parse[struct{ Recorded bool }](t, pa.call("command.record", record, ""))
	require(t, !replay.Recorded, "duplicate wire event recorded")
	type history struct{ Items []intelligence.CommandEvent }
	require(t, len(parse[history](t, pb.call("history.list", empty, "")).Items) == 0, "cross-credential history leaked")
	pb.call("data.export", map[string]string{"cursor": recordID}, "NOT_FOUND")
	pa.call("history.list", map[string]string{"ownerId": first.SessionID}, "INVALID_REQUEST")
	pb.call("admin.overview", empty, "FORBIDDEN")
	usage := parse[intelligence.Usage](t, pa.call("usage.get", empty, ""))
	require(t, usage.Commands == 1 && usage.TotalTokens == 0, "unmeasured usage or duplicate count")
	recommendations := parse[struct {
		Mode  string
		Items []intelligence.Recommendation
	}](t, pa.call("recommendations.get", empty, ""))
	require(t, recommendations.Mode == "catalog" && len(recommendations.Items) > 0, "catalog unavailable or falsely model-backed")
	email := id() + "@example.invalid"
	password := strings.Repeat("synthetic-passphrase-", 10)
	account := parse[intelligence.Snapshot](t, pa.call("account.register", map[string]string{"email": email, "password": password, "name": "Synthetic integration account"}, ""))
	require(t, account.Identity == "authenticated" && account.SessionID != first.SessionID, "registration did not rotate")
	require(t, len(parse[history](t, pa.call("history.list", empty, "")).Items) == 1, "guest record not linked")
	pa.call("account.logout", empty, "")
	require(t, len(parse[history](t, pa.call("history.list", empty, "")).Items) == 0, "logout exposed account history")
	pa.call("account.login", map[string]string{"email": email, "password": password + "wrong"}, "UNAUTHORIZED")
	pa.call("account.login", map[string]string{"email": email, "password": password}, "")
	exported := parse[struct {
		History    []intelligence.CommandEvent
		NextCursor *string
	}](t, pa.call("data.export", empty, ""))
	require(t, len(exported.History) == 1 && exported.NextCursor == nil, "wire export incomplete")
	pa.call("history.delete", empty, "")
	require(t, len(parse[history](t, pa.call("history.list", empty, "")).Items) == 0, "history deletion failed")
	err = db.QueryRow("SELECT count(*) FROM terminus_intelligence.command_events WHERE event_id=$1", recordID).Scan(&count)
	require(t, err == nil && count == 0, "deleted record persisted")
	if ep.RevokeCredential(ctx, a.ID) != nil {
		t.Fatal("revocation failed")
	}
	pa.ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	_, _, err = pa.ws.ReadMessage()
	require(t, err != nil, "revoked real-service socket stayed open")
	// A second owner's authenticated real-service path remains usable.
	require(t, len(parse[history](t, pb.call("history.list", empty, "")).Items) == 0, "revocation affected independent owner")
	t.Log("PASS: real TLS WebSocket + HMAC + endpoint + service + PostgreSQL; synthetic credential/device boundaries; no terminal or model invocation")
}
