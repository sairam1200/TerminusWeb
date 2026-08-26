//go:build windows

package endpoint

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

func TestRealConPTYThroughWSSCleanupPaths(t *testing.T) {
	if testing.Short() {
		t.Skip("real ConPTY integration is exercised by the full Windows suite")
	}
	adapter := terminal.LocalAdapter{}
	store := newMemoryCredentialStore()
	endpoint, err := New(Config{AllowedOrigin: testOrigin, AgentID: testAgentID, Terminal: adapter, Credentials: store,
		ApprovePairing: func(context.Context, PairingApproval) bool { return true }, ResolveDevice: func(*http.Request) (string, error) { return "windows-integration-device", nil }})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewTLSServer(endpoint)
	defer server.Close()

	client, credential := pairAndAuthorize(t, endpoint, server)
	client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	sessionID := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	marker := []byte("S03-WSS-REAL-MARKER")
	client.send("terminal_input", protocol.TerminalPayload{SessionID: sessionID, Data: protocol.EncodeBase64([]byte("Write-Output 'S03-WSS-REAL-MARKER'\r\n"))})
	_ = client.ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	found := false
	for !found {
		frame := client.read("terminal_output")
		data, _ := protocol.DecodeBase64(frame.Value.(*protocol.TerminalPayload).Data, -1)
		found = bytes.Contains(data, marker)
	}
	client.send("resize", protocol.ResizePayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 100, Rows: 35}})
	client.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "user_request"})
	client.read("session_closed")

	lost := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000071")
	lost.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	lost.read("session_opened")
	_ = lost.ws.Close()
	waitNoActiveSession(t, endpoint)

	shutdown := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000072")
	shutdown.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	shutdown.read("session_opened")
	if err := endpoint.Close(); err != nil {
		t.Fatal(err)
	}
	waitNoActiveSession(t, endpoint)
}

func waitNoActiveSession(t *testing.T, endpoint *Endpoint) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		endpoint.sessions.mu.Lock()
		active := endpoint.sessions.active
		endpoint.sessions.mu.Unlock()
		if active == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("real ConPTY session was not cleaned up")
}
