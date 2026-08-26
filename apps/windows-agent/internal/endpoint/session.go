package endpoint

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"io"
	"sync"
	"time"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

type sessionRegistry struct {
	mu      sync.Mutex
	adapter terminal.Adapter
	now     func() time.Time
	active  *managedSession
}

type managedSession struct {
	id                   string
	credentialID         string
	terminal             terminal.Session
	cancel               context.CancelFunc
	owner                *connection
	detached             bool
	resuming             bool
	grant                [32]byte
	grantExpires         time.Time
	detachedConnectionID string
	pending              []byte
	closed               bool
	closeDone            chan struct{}
	closeErr             error
}

func (r *sessionRegistry) open(owner *connection, dimensions protocol.Dimensions) (string, error) {
	r.mu.Lock()
	if r.active != nil {
		r.mu.Unlock()
		return "", errors.New("one terminal session is already active")
	}
	ctx, cancel := context.WithCancel(context.Background())
	session, err := r.adapter.Open(ctx, terminal.Config{Columns: dimensions.Columns, Rows: dimensions.Rows})
	if err != nil {
		cancel()
		r.mu.Unlock()
		return "", err
	}
	id, err := randomUUID()
	if err != nil {
		_ = session.Close()
		cancel()
		r.mu.Unlock()
		return "", err
	}
	managed := &managedSession{id: id, credentialID: owner.credentialID(), terminal: session, cancel: cancel, owner: owner, closeDone: make(chan struct{})}
	r.active = managed
	r.mu.Unlock()
	go r.copyOutput(managed)
	return id, nil
}

func (r *sessionRegistry) input(owner *connection, id string, data []byte) error {
	r.mu.Lock()
	managed, err := r.owned(owner, id)
	r.mu.Unlock()
	if err != nil {
		return protocol.NewError(protocol.InvalidState, 1008, err)
	}
	_, err = managed.terminal.Write(data)
	return err
}

func (r *sessionRegistry) resize(owner *connection, id string, dimensions protocol.Dimensions) error {
	r.mu.Lock()
	managed, err := r.owned(owner, id)
	r.mu.Unlock()
	if err != nil {
		return protocol.NewError(protocol.InvalidState, 1008, err)
	}
	return managed.terminal.Resize(dimensions.Columns, dimensions.Rows)
}

func (r *sessionRegistry) detach(owner *connection, id string) (string, time.Time, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	managed, err := r.owned(owner, id)
	if err != nil {
		return "", time.Time{}, err
	}
	if _, err := rand.Read(managed.grant[:]); err != nil {
		return "", time.Time{}, err
	}
	managed.detached = true
	managed.detachedConnectionID = owner.connectionID()
	managed.owner = nil
	managed.grantExpires = r.now().Add(resumeLifetime)
	expires := managed.grantExpires
	go r.expire(managed, expires)
	return protocol.EncodeBase64(managed.grant[:]), expires, nil
}

func (r *sessionRegistry) resume(owner *connection, id, encodedGrant string, dimensions protocol.Dimensions) error {
	provided, valid := protocol.DecodeBase64(encodedGrant, 32)
	if !valid {
		return errors.New("invalid resume grant")
	}
	r.mu.Lock()
	managed := r.active
	if managed == nil || managed.id != id || !managed.detached || managed.resuming || managed.credentialID != owner.credentialID() || managed.detachedConnectionID == owner.connectionID() || !r.now().Before(managed.grantExpires) || subtle.ConstantTimeCompare(provided, managed.grant[:]) != 1 {
		r.mu.Unlock()
		return errors.New("resume grant rejected")
	}
	managed.grant = [32]byte{}
	managed.resuming = true
	r.mu.Unlock()
	if err := managed.terminal.Resize(dimensions.Columns, dimensions.Rows); err != nil {
		r.closeManaged(managed, "protocol_error")
		return err
	}
	return nil
}

func (r *sessionRegistry) activateResume(owner *connection, id string) error {
	for {
		r.mu.Lock()
		managed := r.active
		if managed == nil || managed.id != id || !managed.resuming {
			r.mu.Unlock()
			return errors.New("session is not resuming")
		}
		if len(managed.pending) == 0 {
			managed.owner = owner
			managed.detached = false
			managed.detachedConnectionID = ""
			managed.resuming = false
			r.mu.Unlock()
			return nil
		}
		pending := append([]byte(nil), managed.pending...)
		managed.pending = nil
		r.mu.Unlock()
		for len(pending) > 0 {
			length := len(pending)
			if length > protocol.MaxTerminalOutput {
				length = protocol.MaxTerminalOutput
			}
			if err := owner.send("terminal_output", protocol.TerminalPayload{SessionID: id, Data: protocol.EncodeBase64(pending[:length])}); err != nil {
				r.closeManaged(managed, "backpressure_limit")
				return err
			}
			pending = pending[length:]
		}
	}
}

func (r *sessionRegistry) abortTransition(id string) {
	r.mu.Lock()
	managed := r.active
	shouldClose := managed != nil && managed.id == id && (managed.detached || managed.resuming)
	r.mu.Unlock()
	if shouldClose {
		_ = r.closeManaged(managed, "protocol_error")
	}
}

func (r *sessionRegistry) revokeCredential(credentialID string) error {
	r.mu.Lock()
	managed := r.active
	r.mu.Unlock()
	if managed == nil || managed.credentialID != credentialID {
		return nil
	}
	return r.closeManaged(managed, "protocol_error")
}

func (r *sessionRegistry) closeBy(owner *connection, id, _ string) error {
	r.mu.Lock()
	managed, err := r.owned(owner, id)
	r.mu.Unlock()
	if err != nil {
		return protocol.NewError(protocol.InvalidState, 1008, err)
	}
	return r.closeManaged(managed, "user_request")
}

func (r *sessionRegistry) close(reason string) error {
	r.mu.Lock()
	managed := r.active
	r.mu.Unlock()
	if managed == nil {
		return nil
	}
	return r.closeManaged(managed, reason)
}

func (r *sessionRegistry) shutdown() error {
	r.mu.Lock()
	managed := r.active
	r.mu.Unlock()
	if managed == nil {
		return nil
	}
	return r.closeManagedMode(managed, "agent_shutdown", false)
}

func (r *sessionRegistry) disconnected(owner *connection) {
	r.mu.Lock()
	managed := r.active
	shouldClose := managed != nil && managed.owner == owner && !managed.detached
	r.mu.Unlock()
	if shouldClose {
		_ = r.closeManaged(managed, "protocol_error")
	}
}

func (r *sessionRegistry) owned(owner *connection, id string) (*managedSession, error) {
	managed := r.active
	if managed == nil || managed.id != id || managed.owner != owner || managed.detached || managed.closed {
		return nil, errors.New("terminal session is not attached to this connection")
	}
	return managed, nil
}

func (r *sessionRegistry) copyOutput(managed *managedSession) {
	buffer := make([]byte, protocol.MaxTerminalOutput)
	for {
		n, err := managed.terminal.Read(buffer)
		if n > 0 {
			chunk := append([]byte(nil), buffer[:n]...)
			r.mu.Lock()
			if managed.closed {
				r.mu.Unlock()
				return
			}
			owner := managed.owner
			if managed.detached || managed.resuming || owner == nil {
				if len(managed.pending)+len(chunk) > maxPendingOutput {
					r.mu.Unlock()
					_ = r.closeManaged(managed, "backpressure_limit")
					return
				}
				managed.pending = append(managed.pending, chunk...)
				r.mu.Unlock()
			} else {
				r.mu.Unlock()
				if sendErr := owner.send("terminal_output", protocol.TerminalPayload{SessionID: managed.id, Data: protocol.EncodeBase64(chunk)}); sendErr != nil {
					_ = r.closeManaged(managed, "backpressure_limit")
					return
				}
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				_ = r.closeManaged(managed, "process_exit")
			} else {
				_ = r.closeManaged(managed, "process_exit")
			}
			return
		}
	}
}

func (r *sessionRegistry) expire(managed *managedSession, expected time.Time) {
	delay := expected.Sub(r.now())
	if delay < 0 {
		delay = 0
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	<-timer.C
	r.mu.Lock()
	expired := r.active == managed && managed.detached && !managed.resuming && managed.grantExpires.Equal(expected) && !r.now().Before(expected)
	r.mu.Unlock()
	if expired {
		_ = r.closeManaged(managed, "idle_timeout")
	}
}

func (r *sessionRegistry) closeManaged(managed *managedSession, reason string) error {
	return r.closeManagedMode(managed, reason, true)
}

func (r *sessionRegistry) closeManagedMode(managed *managedSession, reason string, notify bool) error {
	r.mu.Lock()
	if managed.closed {
		done := managed.closeDone
		r.mu.Unlock()
		<-done
		r.mu.Lock()
		err := managed.closeErr
		r.mu.Unlock()
		return err
	}
	managed.closed = true
	owner := managed.owner
	managed.owner = nil
	r.mu.Unlock()
	managed.cancel()
	err := managed.terminal.Close()
	r.mu.Lock()
	managed.closeErr = err
	if r.active == managed {
		r.active = nil
	}
	r.mu.Unlock()
	if notify && owner != nil && owner.sessionState() == protocol.SessionOpen {
		_ = owner.send("session_closed", protocol.SessionClosedPayload{SessionID: managed.id, Reason: reason})
	}
	close(managed.closeDone)
	return err
}
