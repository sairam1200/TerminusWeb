package endpoint

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"terminus/windows-agent/internal/protocol"
)

func s05008Managed(id, credentialID string) *managedSession {
	return &managedSession{
		id:             id,
		credentialID:   credentialID,
		deviceIdentity: "device-1",
		terminal: &fakeSession{
			output: make(chan []byte, 1),
			closed: make(chan struct{}),
		},
		cancel:    func() {},
		detached:  true,
		closeDone: make(chan struct{}),
	}
}

func s05008Owner(credentialID, device string, index int) *connection {
	return &connection{
		id:         fmt.Sprintf("10000000-0000-4000-8000-%012d", index),
		credential: Credential{ID: credentialID},
		device:     device,
		done:       make(chan struct{}),
		machine:    protocol.NewMachine(protocol.ConnectionReady, protocol.SessionReopening, 0, 0),
		writes:     make(chan outbound, 1),
	}
}

func TestS05008ReopenDenialsAreUniformAndClaimIsAtomic(t *testing.T) {
	credentialID := "30000000-0000-4000-8000-000000000801"
	id := "0000-0000-0801"
	registry := sessionRegistry{
		active:             make(map[string]*managedSession),
		revokedCredentials: make(map[string]struct{}),
	}
	managed := s05008Managed(id, credentialID)
	registry.active[id] = managed
	dimensions := protocol.Dimensions{Columns: 80, Rows: 24}

	denials := []struct {
		name  string
		id    string
		owner *connection
	}{
		{name: "unknown ID", id: "0000-0000-0802", owner: s05008Owner(credentialID, "device-1", 802)},
		{name: "wrong credential", id: id, owner: s05008Owner("30000000-0000-4000-8000-000000000802", "device-1", 803)},
		{name: "wrong source device", id: id, owner: s05008Owner(credentialID, "device-2", 804)},
		{name: "missing source device", id: id, owner: s05008Owner(credentialID, "", 805)},
	}
	for _, test := range denials {
		t.Run(test.name, func(t *testing.T) {
			if _, err := registry.beginReopen(test.owner, test.id, dimensions); err == nil || err.Error() != "session reopen rejected" {
				t.Fatalf("denial = %v, want uniform session reopen rejected", err)
			}
		})
	}

	const contenders = 16
	start := make(chan struct{})
	results := make(chan struct {
		owner    *connection
		snapshot reopenSnapshot
		err      error
	}, contenders)
	for index := range contenders {
		owner := s05008Owner(credentialID, "device-1", 820+index)
		go func() {
			<-start
			snapshot, err := registry.beginReopen(owner, id, dimensions)
			results <- struct {
				owner    *connection
				snapshot reopenSnapshot
				err      error
			}{owner: owner, snapshot: snapshot, err: err}
		}()
	}
	close(start)
	winners := 0
	var winnerOwner *connection
	var winnerSession *managedSession
	for range contenders {
		result := <-results
		if result.err == nil {
			winners++
			winnerOwner = result.owner
			winnerSession = result.snapshot.managed
			continue
		}
		if result.err.Error() != "session reopen rejected" {
			t.Fatalf("concurrent denial = %v", result.err)
		}
	}
	if winners != 1 {
		t.Fatalf("atomic reopen winners = %d, want 1", winners)
	}
	registry.releaseReopen(winnerOwner, winnerSession)

	managed.owner = s05008Owner(credentialID, "device-1", 899)
	managed.detached = false
	if _, err := registry.beginReopen(s05008Owner(credentialID, "device-1", 900), id, dimensions); err == nil || err.Error() != "session reopen rejected" {
		t.Fatalf("attached denial = %v", err)
	}
	managed.owner = nil
	managed.detached = true
	managed.closed = true
	if _, err := registry.beginReopen(s05008Owner(credentialID, "device-1", 901), id, dimensions); err == nil || err.Error() != "session reopen rejected" {
		t.Fatalf("closed denial = %v", err)
	}
}

// This is a finding-reproduction test. It passes when the exact product proves
// that concurrent stalled replays can retain copied snapshots beyond the
// 16 MiB agent-wide history budget while the live history ring is refilled.
func TestS05008StalledReplaySnapshotCopiesExceedAgentBudget(t *testing.T) {
	registry := sessionRegistry{
		active:             make(map[string]*managedSession),
		revokedCredentials: make(map[string]struct{}),
	}
	const waves = 3
	sessionsPerWave := protocol.MaxAgentHistory / protocol.MaxSessionHistory
	chunk := make([]byte, protocol.MaxSessionHistory)
	type stalledReplay struct {
		owner *connection
		done  chan error
	}
	stalled := make([]stalledReplay, 0, waves*sessionsPerWave)
	copiedBytes := 0

	for wave := range waves {
		for index := range sessionsPerWave {
			ordinal := wave*sessionsPerWave + index + 1
			id := fmt.Sprintf("%04x-%04x-%04x", 0, ordinal/0x10000, ordinal%0x10000)
			credentialID := fmt.Sprintf("30000000-0000-4000-8000-%012d", ordinal)
			managed := s05008Managed(id, credentialID)
			registry.active[id] = managed
			if _, ok := registry.appendHistoryLocked(managed, chunk); !ok {
				t.Fatalf("wave %d session %d history append failed", wave, index)
			}
		}

		for index := range sessionsPerWave {
			ordinal := wave*sessionsPerWave + index + 1
			id := fmt.Sprintf("%04x-%04x-%04x", 0, ordinal/0x10000, ordinal%0x10000)
			credentialID := fmt.Sprintf("30000000-0000-4000-8000-%012d", ordinal)
			owner := s05008Owner(credentialID, "device-1", 1000+ordinal)
			snapshot, err := registry.beginReopen(owner, id, protocol.Dimensions{Columns: 80, Rows: 24})
			if err != nil {
				t.Fatal(err)
			}
			for _, frame := range snapshot.frames {
				copiedBytes += len(frame.data)
			}
			done := make(chan error, 1)
			go func() { done <- registry.replay(owner, snapshot) }()
			deadline := time.Now().Add(time.Second)
			for len(owner.writes) != 1 && time.Now().Before(deadline) {
				time.Sleep(time.Millisecond)
			}
			if len(owner.writes) != 1 {
				t.Fatal("replay did not stall on its first outbound frame")
			}
			stalled = append(stalled, stalledReplay{owner: owner, done: done})
		}
		if registry.historyBytes != protocol.MaxAgentHistory {
			t.Fatalf("live history bytes after wave %d = %d, want %d", wave, registry.historyBytes, protocol.MaxAgentHistory)
		}
	}

	if copiedBytes <= protocol.MaxAgentHistory {
		t.Fatalf("stalled snapshot copies = %d, expected to exceed live history budget %d", copiedBytes, protocol.MaxAgentHistory)
	}
	t.Logf("finding reproduced: %d copied snapshot bytes retained while live history remained capped at %d", copiedBytes, registry.historyBytes)

	for _, replay := range stalled {
		item := <-replay.owner.writes
		item.result <- errors.New("release security-review stall")
	}
	for _, replay := range stalled {
		select {
		case <-replay.done:
		case <-time.After(time.Second):
			t.Fatal("stalled replay did not release")
		}
	}
}

func TestS05008HistoryEvictionPreservesSessionsAndDropsDiscardedBytes(t *testing.T) {
	registry := sessionRegistry{active: make(map[string]*managedSession)}
	credentialID := "30000000-0000-4000-8000-000000000850"
	first := s05008Managed("0000-0000-0850", credentialID)
	registry.active[first.id] = first
	if _, ok := registry.appendHistoryLocked(first, make([]byte, protocol.MaxSessionHistory)); !ok {
		t.Fatal("initial history append failed")
	}
	if _, ok := registry.appendHistoryLocked(first, []byte{0x7f}); !ok {
		t.Fatal("boundary history append failed")
	}
	front := first.history.Front().Value.(*historyEntry)
	if first.closed || first.historyBytes != protocol.MaxSessionHistory || front.offset != 1 {
		t.Fatalf("per-session eviction: closed=%v bytes=%d start=%d", first.closed, first.historyBytes, front.offset)
	}
	frames, ok := historyRangeLocked(first, 1, first.nextOffset)
	if !ok || len(frames) == 0 || frames[0].offset != 1 {
		t.Fatalf("retained range exposed a gap or discarded byte: ok=%v frames=%d", ok, len(frames))
	}
	if _, ok := historyRangeLocked(first, 0, first.nextOffset); ok {
		t.Fatal("discarded byte remained replayable")
	}
}
