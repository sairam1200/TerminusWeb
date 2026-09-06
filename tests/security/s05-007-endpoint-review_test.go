package endpoint

import (
	"context"
	"sync"
	"testing"
	"time"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

type s05007StagedAdapter struct {
	mu            sync.Mutex
	calls         int
	secondStarted chan struct{}
	releaseSecond chan struct{}
}

func (a *s05007StagedAdapter) Open(ctx context.Context, config terminal.Config) (terminal.Session, error) {
	a.mu.Lock()
	a.calls++
	call := a.calls
	a.mu.Unlock()

	if call == 2 {
		close(a.secondStarted)
		select {
		case <-a.releaseSecond:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	return &fakeSession{
		output:  make(chan []byte, 4),
		closed:  make(chan struct{}),
		columns: config.Columns,
		rows:    config.Rows,
	}, nil
}

func s05007Owner(credentialID string) *connection {
	return &connection{
		done:       make(chan struct{}),
		credential: Credential{ID: credentialID},
		machine:    protocol.NewMachine(protocol.ConnectionReady, protocol.SessionNone, 0, 0),
	}
}

// This is a finding-reproduction test: it passes when the reviewed exact
// product demonstrates that one stalled Adapter.Open holds the registry-wide
// mutex and blocks cleanup of an unrelated existing session.
func TestS05007StalledOpenBlocksUnrelatedSessionCleanup(t *testing.T) {
	adapter := &s05007StagedAdapter{
		secondStarted: make(chan struct{}),
		releaseSecond: make(chan struct{}),
	}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	firstOwner := s05007Owner("30000000-0000-4000-8000-000000000091")
	secondOwner := s05007Owner("30000000-0000-4000-8000-000000000092")

	firstID, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}

	openDone := make(chan error, 1)
	go func() {
		_, openErr := registry.open(secondOwner, protocol.Dimensions{Columns: 80, Rows: 24})
		openDone <- openErr
	}()
	<-adapter.secondStarted

	closeDone := make(chan error, 1)
	go func() { closeDone <- registry.closeBy(firstOwner, firstID, "user_request") }()

	select {
	case err := <-closeDone:
		t.Fatalf("unrelated cleanup completed while Adapter.Open held the registry mutex: %v", err)
	case <-time.After(150 * time.Millisecond):
		// Finding reproduced.
	}

	close(adapter.releaseSecond)
	if err := <-openDone; err != nil {
		t.Fatal(err)
	}
	if err := <-closeDone; err != nil {
		t.Fatal(err)
	}
	if err := registry.shutdown(); err != nil {
		t.Fatal(err)
	}
}

func TestS05007DetachedBackpressureIsPerSessionAndBounded(t *testing.T) {
	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	firstOwner := s05007Owner("30000000-0000-4000-8000-000000000093")
	secondOwner := s05007Owner("30000000-0000-4000-8000-000000000094")

	firstID, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	secondID, err := registry.open(secondOwner, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.detach(firstOwner, firstID); err != nil {
		t.Fatal(err)
	}

	adapter.mu.Lock()
	firstSession := adapter.sessions[0]
	secondSession := adapter.sessions[1]
	adapter.mu.Unlock()
	chunk := make([]byte, protocol.MaxTerminalOutput)
	firstSession.output <- chunk
	firstSession.output <- chunk
	firstSession.output <- chunk

	select {
	case <-firstSession.closed:
	case <-time.After(time.Second):
		t.Fatal("detached session exceeded its pending-output bound without cleanup")
	}
	select {
	case <-secondSession.closed:
		t.Fatal("one session's backpressure closed an unrelated session")
	default:
	}

	registry.mu.Lock()
	_, firstStillActive := registry.active[firstID]
	_, secondStillActive := registry.active[secondID]
	registry.mu.Unlock()
	if firstStillActive || !secondStillActive {
		t.Fatalf("active accounting after backpressure: first=%v second=%v", firstStillActive, secondStillActive)
	}
	if err := registry.shutdown(); err != nil {
		t.Fatal(err)
	}
}

func TestS05007RevocationClosesAttachedAndDetachedSessions(t *testing.T) {
	adapter := &fakeAdapter{}
	registry := sessionRegistry{adapter: adapter, now: time.Now}
	credentialID := "30000000-0000-4000-8000-000000000095"
	firstOwner := s05007Owner(credentialID)
	secondOwner := s05007Owner(credentialID)

	firstID, err := registry.open(firstOwner, protocol.Dimensions{Columns: 80, Rows: 24})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := registry.open(secondOwner, protocol.Dimensions{Columns: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := registry.detach(firstOwner, firstID); err != nil {
		t.Fatal(err)
	}
	if err := registry.revokeCredential(credentialID); err != nil {
		t.Fatal(err)
	}

	adapter.mu.Lock()
	sessions := append([]*fakeSession(nil), adapter.sessions...)
	adapter.mu.Unlock()
	for index, session := range sessions {
		select {
		case <-session.closed:
		case <-time.After(time.Second):
			t.Fatalf("credential revocation left session %d active", index)
		}
	}
	registry.mu.Lock()
	remaining := len(registry.active)
	registry.mu.Unlock()
	if remaining != 0 {
		t.Fatalf("credential revocation left %d sessions accounted", remaining)
	}
}
