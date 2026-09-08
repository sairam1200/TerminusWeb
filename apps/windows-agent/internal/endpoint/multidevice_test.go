package endpoint

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"terminus/windows-agent/internal/protocol"
)

// Explicit protected-store boundary double. The actual Windows store is
// independently covered in integration-host DPAPI persistence tests.
type deviceBoundTestStore struct{ *memoryCredentialStore }

func (s deviceBoundTestStore) BindDevice(ctx context.Context, id, device string) (Credential, error) {
	credential, err := s.Get(ctx, id)
	if err != nil || credential.DeviceIdentity != device {
		return Credential{}, errors.New("device mismatch")
	}
	return credential, nil
}

func TestMultipleDevicesKeepIndependentHostAuthorizationAndSessions(t *testing.T) {
	store := deviceBoundTestStore{newMemoryCredentialStore()}
	adapter := &fakeAdapter{}
	var approvals atomic.Int32
	ep, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { approvals.Add(1); return true },
		// Synthetic resolver boundary; production derives identity from verified
		// client certificates, never from a browser-supplied header.
		ResolveDevice: func(r *http.Request) (string, error) { return r.Header.Get("Test-Device"), nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(ep)
	defer server.Close()
	defer ep.Close()
	connect := func(device string, credential *Credential) *testClient {
		t.Helper()
		dialer := websocket.Dialer{TLSClientConfig: server.Client().Transport.(*http.Transport).TLSClientConfig, Subprotocols: []string{protocol.Subprotocol}}
		ws, _, err := dialer.Dial("wss"+strings.TrimPrefix(server.URL, "https")+"/terminal", http.Header{"Origin": {testOrigin}, "Test-Device": {device}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { ws.Close() })
		id, err := randomUUID()
		if err != nil {
			t.Fatal(err)
		}
		client := &testClient{t: t, ws: ws, id: id}
		hello := protocol.HelloPayload{ClientInstanceID: testClientID, SupportedVersions: []string{protocol.Version}}
		if credential != nil {
			hello.CredentialID = credential.ID
		}
		client.send("hello", hello)
		if client.read("hello_ack").Value.(*protocol.HelloAckPayload).AgentID != testAgentID {
			t.Fatal("host identity changed")
		}
		return client
	}
	authenticate := func(client *testClient, credential Credential, success bool) {
		t.Helper()
		challenge := client.read("auth_challenge").Value.(*protocol.AuthChallengePayload)
		decoded, _ := protocol.DecodeBase64(challenge.Challenge, 32)
		client.send("auth_response", protocol.AuthResponsePayload{ChallengeID: challenge.ChallengeID, CredentialID: credential.ID, Proof: protocol.EncodeBase64(authProof(credential.Secret[:], client.id, challenge.ChallengeID, decoded))})
		if success {
			client.read("auth_result")
		} else if client.read("error").Value.(*protocol.ErrorPayload).Code != protocol.AuthenticationFailed {
			t.Fatal("wrong auth denial")
		}
	}
	pair := func(device string) (*testClient, Credential) {
		t.Helper()
		code, _, err := ep.IssuePairingCode()
		if err != nil {
			t.Fatal(err)
		}
		client := connect(device, nil)
		client.send("pairing_request", protocol.PairingRequestPayload{PairingCode: code})
		result := client.read("pairing_result").Value.(*protocol.PairingResultPayload)
		credential, err := store.Get(context.Background(), result.CredentialID)
		if err != nil {
			t.Fatal(err)
		}
		if credential.DeviceIdentity != device {
			t.Fatal("credential device binding missing")
		}
		authenticate(client, credential, true)
		return client, credential
	}
	open := func(client *testClient) string {
		t.Helper()
		client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
		return client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	}
	a, credentialA := pair("device-a")
	sessionA := open(a)
	b, credentialB := pair("device-b")
	sessionB := open(b)
	if credentialA.ID == credentialB.ID || credentialA.Secret == credentialB.Secret || sessionA == sessionB {
		t.Fatal("independent device resources shared")
	}
	adapter.mu.Lock()
	shells := append([]*fakeSession(nil), adapter.sessions...)
	adapter.mu.Unlock()
	if len(shells) != 2 {
		t.Fatal("expected independent terminal instances")
	}
	for _, shell := range shells {
		select {
		case <-shell.closed:
			t.Fatal("pairing closed an existing terminal")
		default:
		}
	}
	a.send("terminal_input", protocol.TerminalPayload{SessionID: sessionA, Data: protocol.EncodeBase64([]byte("synthetic-a"))})
	b.send("terminal_input", protocol.TerminalPayload{SessionID: sessionB, Data: protocol.EncodeBase64([]byte("synthetic-b"))})
	waitSessionState(t, shells[0], "synthetic-a", 80, 24)
	waitSessionState(t, shells[1], "synthetic-b", 80, 24)
	// Existing credentials reconnect without new code or approval.
	reconnectA := connect("device-a", &credentialA)
	authenticate(reconnectA, credentialA, true)
	reconnectB := connect("device-b", &credentialB)
	authenticate(reconnectB, credentialB, true)
	if approvals.Load() != 2 {
		t.Fatal("reconnect repeated pairing approval")
	}
	wrongDevice := connect("device-b", &credentialA)
	authenticate(wrongDevice, credentialA, false)
	unauthorized := connect("device-c", nil)
	unauthorized.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	unauthorized.read("error")
	// Even an independently authorized device cannot attach to A's session.
	reconnectB.send("reopen_session", protocol.ReopenSessionPayload{SessionID: sessionA, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	if reconnectB.read("error").Value.(*protocol.ErrorPayload).Code != protocol.SessionReopenRejected {
		t.Fatal("cross-device session attachment accepted")
	}
	if err := ep.RevokeCredential(context.Background(), credentialA.ID); err != nil {
		t.Fatal(err)
	}
	a.read("error")
	reconnectA.read("error")
	requireTestSessionClosed(t, "revoked device", shells[0])
	select {
	case <-shells[1].closed:
		t.Fatal("revocation closed another device session")
	default:
	}
	b.send("resize", protocol.ResizePayload{SessionID: sessionB, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
	waitSessionState(t, shells[1], "synthetic-b", 90, 30)
	denied := connect("device-a", &credentialA)
	if denied.read("error").Value.(*protocol.ErrorPayload).Code != protocol.AuthenticationFailed {
		t.Fatal("revoked credential accepted")
	}
	lastB := connect("device-b", &credentialB)
	authenticate(lastB, credentialB, true)
}

func TestPairingCodeExpirationInvalidReplayAndReplacement(t *testing.T) {
	now := time.Now()
	for _, test := range []string{"valid", "expired", "invalid", "replay", "replacement"} {
		t.Run(test, func(t *testing.T) {
			var manager pairingManager
			code, expires, err := manager.issue(now)
			if err != nil {
				t.Fatal(err)
			}
			if expires.Sub(now) != 120*time.Second {
				t.Fatal("pairing lifetime changed")
			}
			switch test {
			case "valid":
				if !manager.consume(code, now) {
					t.Fatal("valid code denied")
				}
			case "expired":
				if manager.consume(code, expires) {
					t.Fatal("expired code accepted")
				}
			case "invalid":
				if manager.consume("malformed", now) {
					t.Fatal("malformed code accepted")
				}
				if manager.consume(protocol.EncodeBase64(make([]byte, 16)), now) || manager.consume(code, now) {
					t.Fatal("wrong attempt did not burn code")
				}
			case "replay":
				if !manager.consume(code, now) || manager.consume(code, now) {
					t.Fatal("single-use property broken")
				}
			case "replacement":
				fresh, _, err := manager.issue(now)
				if err != nil {
					t.Fatal(err)
				}
				if fresh == code || !manager.consume(fresh, now) || manager.consume(code, now) {
					t.Fatal("replacement not fresh and single-use")
				}
			}
		})
	}
}
