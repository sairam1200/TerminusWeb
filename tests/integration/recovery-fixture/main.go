// Test-only loopback TLS endpoint fixture. Its PTY, device resolver and
// credential store are synthetic boundaries; it never launches a shell.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync"
	"time"

	"terminus/windows-agent/internal/endpoint"
	"terminus/windows-agent/internal/terminal"
)

const credentialID = "30000000-0000-4000-8000-000000000091"
const origin = "https://127.0.0.1:4192"

type memoryStore struct {
	mu         sync.Mutex
	credential endpoint.Credential
}

func (s *memoryStore) Put(_ context.Context, c endpoint.Credential) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.credential = c
	return nil
}
func (s *memoryStore) Get(_ context.Context, id string) (endpoint.Credential, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id != s.credential.ID {
		return endpoint.Credential{}, errors.New("unknown synthetic credential")
	}
	return s.credential, nil
}
func (s *memoryStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if id == s.credential.ID {
		s.credential = endpoint.Credential{}
	}
	return nil
}

type syntheticPTY struct {
	data chan []byte
	done chan struct{}
	once sync.Once
}

func (s *syntheticPTY) Read(p []byte) (int, error) {
	select {
	case b := <-s.data:
		return copy(p, b), nil
	case <-s.done:
		return 0, io.EOF
	}
}
func (s *syntheticPTY) Write(p []byte) (int, error) { return len(p), nil }
func (s *syntheticPTY) Resize(uint16, uint16) error { return nil }
func (s *syntheticPTY) Wait() error                 { <-s.done; return nil }
func (s *syntheticPTY) Close() error                { s.once.Do(func() { close(s.done) }); return nil }

type syntheticAdapter struct {
	mu       sync.Mutex
	sessions []*syntheticPTY
}

func (a *syntheticAdapter) Open(context.Context, terminal.Config) (terminal.Session, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	s := &syntheticPTY{data: make(chan []byte, 16), done: make(chan struct{})}
	a.sessions = append(a.sessions, s)
	return s, nil
}
func main() {
	c := endpoint.Credential{ID: credentialID, DeviceIdentity: "synthetic-s06-device", ExpiresAt: time.Now().Add(time.Hour)}
	for i := range c.Secret {
		c.Secret[i] = byte(i)
	}
	store := &memoryStore{credential: c}
	adapter := &syntheticAdapter{}
	ep, err := endpoint.New(endpoint.Config{AllowedOrigin: origin, AgentID: "50000000-0000-4000-8000-000000000091", Credentials: store, Terminal: adapter, ApprovePairing: func(context.Context, endpoint.PairingApproval) bool { return false }, ResolveDevice: func(*http.Request) (string, error) { return "synthetic-s06-device", nil }})
	if err != nil {
		panic("synthetic endpoint setup failed")
	}
	defer ep.Close()
	mux := http.NewServeMux()
	mux.Handle("/terminal", ep)
	// Fixture-only metadata/emit controls are never part of a product endpoint.
	mux.HandleFunc("/fixture/state", func(w http.ResponseWriter, r *http.Request) {
		adapter.mu.Lock()
		defer adapter.mu.Unlock()
		closed := 0
		for _, s := range adapter.sessions {
			select {
			case <-s.done:
				closed++
			default:
			}
		}
		json.NewEncoder(w).Encode(map[string]int{"opened": len(adapter.sessions), "closed": closed})
	})
	mux.HandleFunc("/fixture/emit", func(w http.ResponseWriter, r *http.Request) {
		adapter.mu.Lock()
		defer adapter.mu.Unlock()
		if len(adapter.sessions) != 1 {
			http.Error(w, "fixture session count", 409)
			return
		}
		select {
		case adapter.sessions[0].data <- []byte("S06-SYNTHETIC-OUTPUT;"):
			w.WriteHeader(204)
		default:
			http.Error(w, "fixture queue full", 409)
		}
	})
	server := httptest.NewTLSServer(mux)
	defer server.Close()
	cert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw})
	// Only a disposable public test certificate and loopback address are emitted.
	json.NewEncoder(os.Stdout).Encode(map[string]string{"url": server.URL, "ca": string(cert)})
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Scan()
}
