package endpoint

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"terminus/windows-agent/internal/protocol"
)

type intelligenceDouble struct{ calls atomic.Int32 }

func (s *intelligenceDouble) Call(context.Context, IntelligencePrincipal, string, json.RawMessage) (any, string) {
	s.calls.Add(1)
	return map[string]bool{"tested": true}, ""
}

func TestIntelligenceCanonicalAuthVector(t *testing.T) {
	// Consume the immutable Session01 contract directly when the integration
	// checkout has not yet imported its artifact.
	raw, err := os.ReadFile("../../../../packages/protocol/intelligence-auth-vectors-1.0.json")
	if err != nil {
		raw, err = exec.Command("git", "show", "79cc961:packages/protocol/intelligence-auth-vectors-1.0.json").Output()
	}
	if err != nil {
		t.Fatal("canonical fixture unavailable")
	}
	var fixture struct {
		Positive struct{ CredentialSecret, ConnectionID, ChallengeID, Challenge, Proof string }
	}
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("fixture invalid")
	}
	v := fixture.Positive
	secret, _ := protocol.DecodeBase64(v.CredentialSecret, 32)
	challenge, _ := protocol.DecodeBase64(v.Challenge, 32)
	if protocol.EncodeBase64(intelligenceProof(secret, v.ConnectionID, v.ChallengeID, challenge)) != v.Proof {
		t.Fatal("canonical auth mismatch")
	}
	if protocol.EncodeBase64(authProof(secret, v.ConnectionID, v.ChallengeID, challenge)) == v.Proof {
		t.Fatal("terminal proof reused")
	}
	if protocol.EncodeBase64(intelligenceProof(secret, "33333333-3333-4333-8333-333333333333", v.ChallengeID, challenge)) == v.Proof || protocol.EncodeBase64(intelligenceProof(secret, v.ConnectionID, "33333333-3333-4333-8333-333333333333", challenge)) == v.Proof {
		t.Fatal("challenge identifiers not bound")
	}
	challenge[0] ^= 1
	if protocol.EncodeBase64(intelligenceProof(secret, v.ConnectionID, v.ChallengeID, challenge)) == v.Proof {
		t.Fatal("challenge not bound")
	}
	challenge[0] ^= 1
	secret[0] ^= 1
	if protocol.EncodeBase64(intelligenceProof(secret, v.ConnectionID, v.ChallengeID, challenge)) == v.Proof {
		t.Fatal("key not bound")
	}
}

func TestIntelligenceAuthenticatedRPCAndRevocation(t *testing.T) {
	store := &memoryCredentialStore{credentials: map[string]Credential{}}
	cred := Credential{ID: "70000000-0000-4000-8000-000000000099", ExpiresAt: time.Now().Add(time.Hour), DeviceIdentity: "test-device"}
	store.Put(context.Background(), cred)
	ep, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: &fakeAdapter{}, Credentials: store, ApprovePairing: func(context.Context, PairingApproval) bool { return false }, ResolveDevice: func(*http.Request) (string, error) { return "test-device", nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer ep.Close()
	double := &intelligenceDouble{}
	server := httptest.NewTLSServer(ep.IntelligenceHandler(double))
	defer server.Close()
	roots := server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots}, Subprotocols: []string{IntelligenceSubprotocol}}
	ws, _, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/intelligence", http.Header{"Origin": []string{testOrigin}})
	if err != nil {
		t.Fatal(err)
	}
	defer ws.Close()
	var ch struct{ Type, ConnectionID, ChallengeID, Challenge, ExpiresAt string }
	if ws.ReadJSON(&ch) != nil {
		t.Fatal("challenge missing")
	}
	value, _ := protocol.DecodeBase64(ch.Challenge, 32)
	if ws.WriteJSON(map[string]string{"type": "authenticate", "credentialId": cred.ID, "proof": protocol.EncodeBase64(intelligenceProof(cred.Secret[:], ch.ConnectionID, ch.ChallengeID, value))}) != nil {
		t.Fatal("auth write")
	}
	var ready map[string]any
	if ws.ReadJSON(&ready) != nil || ready["type"] != "ready" {
		t.Fatal("auth rejected")
	}
	if ws.WriteJSON(map[string]any{"type": "request", "id": "10000000-0000-4000-8000-000000000001", "method": "session.current", "params": map[string]any{}}) != nil {
		t.Fatal("request write")
	}
	var result map[string]any
	if ws.ReadJSON(&result) != nil || result["ok"] != true || double.calls.Load() != 1 {
		t.Fatal("authenticated RPC failed")
	}
	if ep.RevokeCredential(context.Background(), cred.ID) != nil {
		t.Fatal("revoke failed")
	}
	ws.SetReadDeadline(time.Now().Add(3 * time.Second))
	if _, _, err = ws.ReadMessage(); err == nil {
		t.Fatal("revoked intelligence remained open")
	}
}

func TestIntelligenceClosedJSON(t *testing.T) {
	var target struct {
		Type string `json:"type"`
	}
	for _, raw := range []string{`{"type":"one","type":"two"}`, `{"type":"one","unknown":true}`, `{"type":"one"} {}`, `[]`, `{"type":"one","nested":{"key":1,"key":2}}`} {
		if strictIntelligenceJSON([]byte(raw), &target) == nil {
			t.Fatal("ambiguous JSON accepted")
		}
	}
}

func TestIntelligenceRejectsWrongIdentityProofAndMalformedTraffic(t *testing.T) {
	for _, scenario := range []string{"wrong-origin", "wrong-device", "unbound", "wrong-proof", "terminal-proof", "expired", "stale-challenge", "replay-auth", "unknown-field", "binary", "oversized"} {
		t.Run(scenario, func(t *testing.T) {
			store := &memoryCredentialStore{credentials: map[string]Credential{}}
			cred := Credential{ID: "70000000-0000-4000-8000-000000000088", ExpiresAt: time.Now().Add(time.Hour), DeviceIdentity: "test-device"}
			if scenario == "wrong-device" {
				cred.DeviceIdentity = "another-device"
			}
			if scenario == "unbound" {
				cred.DeviceIdentity = ""
			}
			if scenario == "expired" {
				cred.ExpiresAt = time.Now().Add(-time.Second)
			}
			store.Put(context.Background(), cred)
			var offset atomic.Int64
			ep, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: &fakeAdapter{}, Credentials: store, ApprovePairing: func(context.Context, PairingApproval) bool { return false }, ResolveDevice: func(*http.Request) (string, error) { return "test-device", nil }, Now: func() time.Time { return time.Now().Add(time.Duration(offset.Load())) }})
			if err != nil {
				t.Fatal(err)
			}
			defer ep.Close()
			double := &intelligenceDouble{}
			server := httptest.NewTLSServer(ep.IntelligenceHandler(double))
			defer server.Close()
			roots := server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
			dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots}, Subprotocols: []string{IntelligenceSubprotocol}}
			origin := testOrigin
			if scenario == "wrong-origin" {
				origin = "https://wrong.example.invalid"
			}
			ws, resp, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/intelligence", http.Header{"Origin": []string{origin}})
			if scenario == "wrong-origin" {
				if err == nil || resp.StatusCode != 403 {
					t.Fatal("origin accepted")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer ws.Close()
			var ch struct{ Type, ConnectionID, ChallengeID, Challenge, ExpiresAt string }
			if ws.ReadJSON(&ch) != nil {
				t.Fatal("challenge missing")
			}
			value, _ := protocol.DecodeBase64(ch.Challenge, 32)
			if scenario == "stale-challenge" {
				offset.Store(int64(11 * time.Second))
			}
			proof := intelligenceProof(cred.Secret[:], ch.ConnectionID, ch.ChallengeID, value)
			if scenario == "wrong-proof" {
				proof[0] ^= 1
			}
			if scenario == "terminal-proof" {
				proof = authProof(cred.Secret[:], ch.ConnectionID, ch.ChallengeID, value)
			}
			auth := map[string]string{"type": "authenticate", "credentialId": cred.ID, "proof": protocol.EncodeBase64(proof)}
			if ws.WriteJSON(auth) != nil {
				t.Fatal("auth write")
			}
			ws.SetReadDeadline(time.Now().Add(2 * time.Second))
			var ready map[string]any
			err = ws.ReadJSON(&ready)
			switch scenario {
			case "wrong-device", "unbound", "wrong-proof", "terminal-proof", "expired", "stale-challenge":
				if err == nil {
					t.Fatal("invalid authentication accepted")
				}
				return
			}
			if err != nil || ready["type"] != "ready" {
				t.Fatal("setup auth failed")
			}
			switch scenario {
			case "replay-auth":
				ws.WriteJSON(auth)
			case "unknown-field":
				ws.WriteMessage(websocket.TextMessage, []byte(`{"type":"request","id":"10000000-0000-4000-8000-000000000001","method":"session.current","params":{},"userId":"injected"}`))
			case "binary":
				ws.WriteMessage(websocket.BinaryMessage, []byte{1})
			case "oversized":
				ws.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", 65537)))
			}
			if _, _, err := ws.ReadMessage(); err == nil {
				t.Fatal("malformed traffic accepted")
			}
			if double.calls.Load() != 0 {
				t.Fatal("unauthorized RPC executed")
			}
		})
	}
}

func TestIntelligenceCompletedAuthDoesNotReserveTerminalAdmission(t *testing.T) {
	ep, _, store := newTestEndpoint(t)
	defer ep.Close()
	cred := Credential{ID: "70000000-0000-4000-8000-000000000077", ExpiresAt: time.Now().Add(time.Hour), DeviceIdentity: "device-1"}
	store.Put(context.Background(), cred)
	mux := http.NewServeMux()
	mux.Handle("/terminal", ep)
	mux.Handle("/intelligence", ep.IntelligenceHandler(&intelligenceDouble{}))
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	roots := server.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs
	dialer := websocket.Dialer{TLSClientConfig: &tls.Config{RootCAs: roots}, Subprotocols: []string{IntelligenceSubprotocol}}
	for i := 0; i < 10; i++ {
		ws, _, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/intelligence", http.Header{"Origin": []string{testOrigin}})
		if err != nil {
			t.Fatalf("connection %d rejected", i)
		}
		defer ws.Close()
		var ch struct{ ConnectionID, ChallengeID, Challenge string }
		if ws.ReadJSON(&ch) != nil {
			t.Fatal("challenge failed")
		}
		value, _ := protocol.DecodeBase64(ch.Challenge, 32)
		if ws.WriteJSON(map[string]string{"type": "authenticate", "credentialId": cred.ID, "proof": protocol.EncodeBase64(intelligenceProof(cred.Secret[:], ch.ConnectionID, ch.ChallengeID, value))}) != nil {
			t.Fatal("auth failed")
		}
		var ready map[string]any
		if ws.ReadJSON(&ready) != nil || ready["type"] != "ready" {
			t.Fatal("ready failed")
		}
	}
	dialer.Subprotocols = []string{protocol.Subprotocol}
	ws, _, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/terminal", http.Header{"Origin": []string{testOrigin}})
	if err != nil {
		t.Fatal("terminal admission blocked by intelligence")
	}
	defer ws.Close()
	client := &testClient{t: t, ws: ws, id: "10000000-0000-4000-8000-000000000077"}
	client.send("hello", protocol.HelloPayload{ClientInstanceID: testClientID, CredentialID: cred.ID, SupportedVersions: []string{protocol.Version}})
	client.read("hello_ack")
	challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
	value, _ := protocol.DecodeBase64(challenge.Challenge, 32)
	client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: cred.ID, Proof: protocol.EncodeBase64(authProof(cred.Secret[:], client.id, challenge.ChallengeID, value))})
	client.read("auth_result")
}

func TestIntelligenceCanonicalRPCEnvelopeRejections(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/protocol/intelligence-rpc-fixtures-1.0.json")
	if err != nil {
		raw, err = exec.Command("git", "show", "7eab6ce:packages/protocol/intelligence-rpc-fixtures-1.0.json").Output()
	}
	if err != nil {
		t.Fatal("canonical corpus unavailable")
	}
	var corpus struct {
		Rejected []struct {
			Name  string
			Frame json.RawMessage
		}
	}
	if json.Unmarshal(raw, &corpus) != nil {
		t.Fatal("corpus invalid")
	}
	for _, item := range corpus.Rejected {
		if item.Name != "unknown-envelope-field" && item.Name != "invalid-id" {
			continue
		}
		var req struct {
			Type   string          `json:"type"`
			ID     string          `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if strictIntelligenceJSON(item.Frame, &req) == nil && protocol.ValidUUID(req.ID) {
			t.Fatal("canonical invalid envelope accepted")
		}
	}
}
