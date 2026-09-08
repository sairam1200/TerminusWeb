package endpoint

import (
	"net/http/httptest"
	"testing"
	"time"

	"terminus/windows-agent/internal/protocol"
)

func waitRecoveryCondition(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("host recovery condition did not complete within one second")
}

func TestBrowserLossPreservesSameShellAndOrderedBackgroundOutput(t *testing.T) {
	for _, loss := range []string{"client_heartbeat_error", "client_authorization_error", "legacy_client_transport_error", "abrupt_transport"} {
		t.Run(loss, func(t *testing.T) {
			ep, adapter, _ := newTestEndpoint(t)
			server := httptest.NewTLSServer(ep)
			defer server.Close()
			defer ep.Close()
			client, credential := pairAndAuthorize(t, ep, server)
			defer client.ws.Close()
			client.ws.SetReadDeadline(time.Now().Add(3 * time.Second))
			client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
			id := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
			adapter.mu.Lock()
			shell := adapter.sessions[0]
			adapter.mu.Unlock()
			ep.sessions.mu.Lock()
			managed := ep.sessions.active[id]
			owner := managed.owner
			ep.sessions.mu.Unlock()
			shell.output <- []byte("synthetic-before;")
			client.read("terminal_output")
			if loss == "abrupt_transport" {
				client.ws.Close()
			} else {
				code := protocol.HeartbeatTimeout
				if loss == "client_authorization_error" {
					code = protocol.AuthorizationExpired
				}
				if loss == "legacy_client_transport_error" {
					// Deployed older browsers reported WebSocket onerror using
					// this valid operational error rather than a liveness code.
					code = protocol.SessionOpenFailed
				}
				client.send("error", protocol.ErrorPayload{Code: code, Fatal: true})
				// Deliberately leave the client's socket open, as a suspended
				// browser can do after reporting a fatal liveness error.
			}
			select {
			case <-owner.done:
			case <-time.After(time.Second):
				t.Fatal("client loss left the old connection owning its terminal")
			}
			waitRecoveryCondition(t, func() bool {
				ep.sessions.mu.Lock()
				defer ep.sessions.mu.Unlock()
				return managed.owner == nil && managed.detached && !managed.closed
			})
			select {
			case <-shell.closed:
				t.Fatal("recoverable browser loss ended host shell")
			default:
			}
			// Output continues while no browser connection owns the terminal.
			shell.output <- []byte("synthetic-background;")
			want := "synthetic-before;synthetic-background;"
			waitRecoveryCondition(t, func() bool {
				ep.sessions.mu.Lock()
				defer ep.sessions.mu.Unlock()
				return managed.nextOffset == uint64(len(want))
			})
			reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000096")
			defer reopened.ws.Close()
			reopened.ws.SetReadDeadline(time.Now().Add(3 * time.Second))
			reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: id, Dimensions: protocol.Dimensions{Columns: 90, Rows: 30}})
			if reopened.read("session_reopened").Value.(*protocol.SessionIDPayload).SessionID != id {
				t.Fatal("recovery changed session")
			}
			begin := reopened.read("history_begin").Value.(*protocol.HistoryBeginPayload)
			var history []byte
			for uint64(len(history)) < begin.EndOffset {
				chunk := reopened.read("history_chunk").Value.(*protocol.HistoryChunkPayload)
				if chunk.Offset != uint64(len(history)) {
					t.Fatal("replayed output was not ordered")
				}
				data, _ := protocol.DecodeBase64(chunk.Data, -1)
				history = append(history, data...)
			}
			end := reopened.read("history_end").Value.(*protocol.HistoryEndPayload)
			if string(history) != want || begin.StartOffset != 0 || begin.Truncated || end.EndOffset != uint64(len(want)) {
				t.Fatal("recovery lost retained output")
			}
			adapter.mu.Lock()
			sameShell := len(adapter.sessions) == 1 && adapter.sessions[0] == shell
			adapter.mu.Unlock()
			if !sameShell {
				t.Fatal("recovery created another shell")
			}
			// A duplicate old disconnect cannot take the recovered owner away.
			ep.sessions.disconnected(owner)
			reopened.send("terminal_input", protocol.TerminalPayload{SessionID: id, Data: protocol.EncodeBase64([]byte("synthetic-input"))})
			waitSessionState(t, shell, "synthetic-input", 90, 30)
		})
	}
}

func TestClientFatalProtocolErrorStillDestroysOwnedShell(t *testing.T) {
	for _, source := range []string{"client_protocol_violation", "local_operational_failure"} {
		t.Run(source, func(t *testing.T) {
			ep, adapter, _ := newTestEndpoint(t)
			server := httptest.NewTLSServer(ep)
			defer server.Close()
			defer ep.Close()
			client, _ := pairAndAuthorize(t, ep, server)
			defer client.ws.Close()
			client.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
			id := client.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
			adapter.mu.Lock()
			shell := adapter.sessions[0]
			adapter.mu.Unlock()
			ep.sessions.mu.Lock()
			managed := ep.sessions.active[id]
			ep.sessions.mu.Unlock()
			if source == "client_protocol_violation" {
				client.send("error", protocol.ErrorPayload{Code: protocol.SequenceReplay, Fatal: true})
			} else {
				// The received-client compatibility exception must not affect the
				// local failure path or its containment cleanup.
				go managed.owner.fail(protocol.NewError(protocol.SessionOpenFailed, 1008, nil))
			}
			select {
			case <-managed.closeDone:
			case <-time.After(time.Second):
				t.Fatal("fatal protocol error did not finish terminal cleanup")
			}
			select {
			case <-shell.closed:
			default:
				t.Fatal("fatal protocol error preserved shell")
			}
			ep.sessions.mu.Lock()
			remaining := len(ep.sessions.active)
			history := ep.sessions.historyBytes
			ep.sessions.mu.Unlock()
			if remaining != 0 || history != 0 {
				t.Fatal("fatal protocol error retained session resources")
			}
		})
	}
}
