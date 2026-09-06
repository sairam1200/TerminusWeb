//go:build windows

package endpoint

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"testing"
	"time"

	"golang.org/x/sys/windows"
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
		data, _ := protocol.DecodeBase64(frame.Value.(*protocol.TerminalOutputPayload).Data, -1)
		found = bytes.Contains(data, marker)
	}
	client.send("resize", protocol.ResizePayload{SessionID: sessionID, Dimensions: protocol.Dimensions{Columns: 100, Rows: 35}})
	client.send("close_session", protocol.CloseSessionPayload{SessionID: sessionID, Reason: "user_request"})
	client.read("session_closed")

	lost := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000071")
	lost.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	lostID := lost.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	lostShell, lostChild := captureProcessTree(t, lost, lostID)
	_ = lost.ws.Close()
	waitDetachedSession(t, endpoint, lostID)
	for _, pid := range []uint32{lostShell, lostChild} {
		alive, err := processAlive(pid)
		if err != nil || !alive {
			t.Fatalf("retained process %d alive=%v err=%v", pid, alive, err)
		}
	}
	reopened := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000073")
	reopened.send("reopen_session", protocol.ReopenSessionPayload{SessionID: lostID, Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	reopened.read("session_reopened")
	begin := reopened.read("history_begin").Value.(*protocol.HistoryBeginPayload)
	var replayed []byte
	for begin.StartOffset+uint64(len(replayed)) < begin.EndOffset {
		chunk := reopened.read("history_chunk").Value.(*protocol.HistoryChunkPayload)
		data, _ := protocol.DecodeBase64(chunk.Data, -1)
		replayed = append(replayed, data...)
	}
	reopened.read("history_end")
	if !bytes.Contains(replayed, []byte("S03PIDS-")) {
		t.Fatal("real ConPTY replay did not contain the synthetic process marker")
	}
	reopened.send("close_session", protocol.CloseSessionPayload{SessionID: lostID, Reason: "user_request"})
	reopened.read("session_closed")
	waitNoActiveSession(t, endpoint)
	waitProcessesGone(t, lostShell, lostChild)

	shutdown := authorizeExisting(t, server, credential, "10000000-0000-4000-8000-000000000072")
	shutdown.send("open_session", protocol.OpenSessionPayload{Shell: "powershell", Dimensions: protocol.Dimensions{Columns: 80, Rows: 24}})
	shutdownID := shutdown.read("session_opened").Value.(*protocol.SessionIDPayload).SessionID
	shutdownShell, shutdownChild := captureProcessTree(t, shutdown, shutdownID)
	if err := endpoint.Close(); err != nil {
		t.Fatal(err)
	}
	waitNoActiveSession(t, endpoint)
	waitProcessesGone(t, shutdownShell, shutdownChild)
}

func captureProcessTree(t *testing.T, client *testClient, sessionID string) (uint32, uint32) {
	t.Helper()
	client.send("terminal_input", protocol.TerminalPayload{SessionID: sessionID, Data: protocol.EncodeBase64([]byte("$child=Start-Process ping.exe -ArgumentList '-t','127.0.0.1' -PassThru; Write-Output (\"S03PIDS-{0}-{1}\" -f $PID,$child.Id)\r\n"))})
	_ = client.ws.SetReadDeadline(time.Now().Add(10 * time.Second))
	pattern := regexp.MustCompile(`S03PIDS-(\d+)-(\d+)`)
	var output []byte
	for {
		frame := client.read("terminal_output")
		data, _ := protocol.DecodeBase64(frame.Value.(*protocol.TerminalOutputPayload).Data, -1)
		output = append(output, data...)
		match := pattern.FindSubmatch(output)
		if match != nil {
			shell, _ := strconv.ParseUint(string(match[1]), 10, 32)
			child, _ := strconv.ParseUint(string(match[2]), 10, 32)
			return uint32(shell), uint32(child)
		}
	}
}

func waitDetachedSession(t *testing.T, endpoint *Endpoint, sessionID string) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		endpoint.sessions.mu.Lock()
		managed := endpoint.sessions.active[sessionID]
		detached := managed != nil && managed.detached && managed.owner == nil
		endpoint.sessions.mu.Unlock()
		if detached {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("real ConPTY session did not detach")
}

func waitProcessesGone(t *testing.T, pids ...uint32) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		allGone := true
		for _, pid := range pids {
			alive, err := processAlive(pid)
			if err != nil {
				t.Fatal(err)
			}
			allGone = allGone && !alive
		}
		if allGone {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("real WSS cleanup left the synthetic PowerShell process tree alive")
}

func processAlive(pid uint32) (bool, error) {
	handle, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer windows.CloseHandle(handle)
	status, err := windows.WaitForSingleObject(handle, 0)
	if err != nil {
		return false, err
	}
	return status == uint32(windows.WAIT_TIMEOUT), nil
}

func waitNoActiveSession(t *testing.T, endpoint *Endpoint) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		endpoint.sessions.mu.Lock()
		active := len(endpoint.sessions.active)
		endpoint.sessions.mu.Unlock()
		if active == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("real ConPTY session was not cleaned up")
}
