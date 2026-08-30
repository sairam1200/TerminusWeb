package endpoint

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"time"

	"terminus/windows-agent/internal/protocol"
	"terminus/windows-agent/internal/terminal"
)

const sessionIDGenerationAttempts = 8

type sessionRegistry struct {
	mu                 sync.Mutex
	adapter            terminal.Adapter
	now                func() time.Time
	newSessionID       func() (string, error)
	active             map[string]*managedSession
	pending            map[*pendingSessionOpen]struct{}
	revokedCredentials map[string]struct{}
	history            list.List
	historyBytes       int
	shuttingDown       bool
}

type pendingSessionOpen struct {
	id           string
	owner        *connection
	credentialID string
	cancel       context.CancelFunc
}

type managedSession struct {
	id                string
	credentialID      string
	credentialExpires time.Time
	deviceIdentity    string
	terminal          terminal.Session
	cancel            context.CancelFunc
	owner             *connection
	detached          bool
	replaying         bool
	history           list.List
	historyBytes      int
	nextOffset        uint64
	closed            bool
	closeDone         chan struct{}
	closeErr          error
}

type historyEntry struct {
	session        *managedSession
	offset         uint64
	data           []byte
	sessionElement *list.Element
	globalElement  *list.Element
}

type historyFrame struct {
	offset uint64
	data   []byte
}

type reopenSnapshot struct {
	managed   *managedSession
	id        string
	start     uint64
	end       uint64
	truncated bool
	frames    []historyFrame
}

func (r *sessionRegistry) open(owner *connection, dimensions protocol.Dimensions) (string, error) {
	credentialID := owner.credentialID()
	r.mu.Lock()
	if err := r.admissionError(owner, credentialID); err != nil {
		r.mu.Unlock()
		return "", err
	}
	id, err := r.reserveSessionIDLocked()
	if err != nil {
		r.mu.Unlock()
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	pending := &pendingSessionOpen{id: id, owner: owner, credentialID: credentialID, cancel: cancel}
	if r.pending == nil {
		r.pending = make(map[*pendingSessionOpen]struct{})
	}
	r.pending[pending] = struct{}{}
	r.mu.Unlock()

	session, err := r.adapter.Open(ctx, terminal.Config{Columns: dimensions.Columns, Rows: dimensions.Rows})
	if err != nil {
		cancel()
		r.removePending(pending)
		return "", err
	}
	credential := owner.credentialSnapshot()
	managed := &managedSession{
		id: id, credentialID: credentialID, deviceIdentity: owner.device,
		credentialExpires: credential.ExpiresAt, terminal: session, cancel: cancel, owner: owner, closeDone: make(chan struct{}),
	}
	r.mu.Lock()
	delete(r.pending, pending)
	if err := r.admissionError(owner, credentialID); err != nil {
		r.mu.Unlock()
		cancel()
		return "", errors.Join(err, session.Close())
	}
	if r.active == nil {
		r.active = make(map[string]*managedSession)
	}
	if _, exists := r.active[id]; exists {
		r.mu.Unlock()
		cancel()
		return "", errors.Join(errors.New("terminal session identifier collision"), session.Close())
	}
	r.active[id] = managed
	r.mu.Unlock()
	go r.copyOutput(managed)
	if !managed.credentialExpires.IsZero() {
		go r.expireManagedCredential(managed, managed.credentialExpires)
	}
	return id, nil
}

func (r *sessionRegistry) expireManagedCredential(managed *managedSession, expires time.Time) {
	now := time.Now
	if r.now != nil {
		now = r.now
	}
	delay := expires.Sub(now())
	if delay < 0 {
		delay = 0
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-timer.C:
	case <-managed.closeDone:
		return
	}
	r.mu.Lock()
	expired := r.active[managed.id] == managed && !managed.closed && !now().Before(expires)
	r.mu.Unlock()
	if expired {
		_ = r.closeManaged(managed, "credential_expired")
	}
}

func (r *sessionRegistry) reserveSessionIDLocked() (string, error) {
	generator := r.newSessionID
	if generator == nil {
		generator = randomSessionID
	}
	for range sessionIDGenerationAttempts {
		id, err := generator()
		if err != nil {
			return "", err
		}
		if !protocol.ValidSessionID(id) || r.idInUseLocked(id) {
			continue
		}
		return id, nil
	}
	return "", errors.New("terminal session identifier generation exhausted")
}

func (r *sessionRegistry) idInUseLocked(id string) bool {
	if r.active[id] != nil {
		return true
	}
	for pending := range r.pending {
		if pending.id == id {
			return true
		}
	}
	return false
}

// admissionError must be called with r.mu held. Keeping the final validation
// and registration under one lock prevents shutdown, disconnect, or revocation
// from missing a terminal whose potentially blocking creation ran unlocked.
func (r *sessionRegistry) admissionError(owner *connection, credentialID string) error {
	if r.shuttingDown {
		return errors.New("terminal session admission is unavailable")
	}
	if _, revoked := r.revokedCredentials[credentialID]; revoked {
		return errors.New("terminal session credential is revoked")
	}
	select {
	case <-owner.done:
		return errors.New("terminal session connection is closed")
	default:
		return nil
	}
}

func (r *sessionRegistry) removePending(pending *pendingSessionOpen) {
	r.mu.Lock()
	delete(r.pending, pending)
	r.mu.Unlock()
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

func (r *sessionRegistry) detach(owner *connection, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	managed, err := r.owned(owner, id)
	if err != nil {
		return err
	}
	managed.owner = nil
	managed.detached = true
	return nil
}

func (r *sessionRegistry) beginReopen(owner *connection, id string, dimensions protocol.Dimensions) (reopenSnapshot, error) {
	r.mu.Lock()
	managed := r.active[id]
	if managed == nil || managed.closed || !managed.detached || managed.replaying || managed.owner != nil ||
		managed.credentialID != owner.credentialID() || managed.deviceIdentity == "" || owner.device == "" || managed.deviceIdentity != owner.device ||
		r.shuttingDown || r.credentialRevokedLocked(managed.credentialID) || owner.isDone() {
		r.mu.Unlock()
		return reopenSnapshot{}, errors.New("session reopen rejected")
	}
	managed.owner = owner
	managed.detached = false
	managed.replaying = true
	snapshot := r.snapshotLocked(managed)
	r.mu.Unlock()

	if err := managed.terminal.Resize(dimensions.Columns, dimensions.Rows); err != nil {
		_ = r.closeManaged(managed, "protocol_error")
		return reopenSnapshot{}, err
	}
	return snapshot, nil
}

func (r *sessionRegistry) snapshotLocked(managed *managedSession) reopenSnapshot {
	start := managed.nextOffset
	if front := managed.history.Front(); front != nil {
		start = front.Value.(*historyEntry).offset
	}
	snapshot := reopenSnapshot{managed: managed, id: managed.id, start: start, end: managed.nextOffset, truncated: start > 0}
	for element := managed.history.Front(); element != nil; element = element.Next() {
		entry := element.Value.(*historyEntry)
		snapshot.frames = append(snapshot.frames, historyFrame{offset: entry.offset, data: append([]byte(nil), entry.data...)})
	}
	return snapshot
}

func (r *sessionRegistry) replay(owner *connection, snapshot reopenSnapshot) error {
	owner.setOutputOffset(snapshot.end)
	if err := owner.send("session_reopened", protocol.SessionIDPayload{SessionID: snapshot.id}); err != nil {
		r.releaseReopen(owner, snapshot.managed)
		return err
	}
	if err := owner.send("history_begin", protocol.HistoryBeginPayload{SessionID: snapshot.id, StartOffset: snapshot.start, EndOffset: snapshot.end, Truncated: snapshot.truncated}); err != nil {
		r.releaseReopen(owner, snapshot.managed)
		return err
	}
	for _, frame := range snapshot.frames {
		if err := owner.send("history_chunk", protocol.HistoryChunkPayload{SessionID: snapshot.id, Offset: frame.offset, Data: protocol.EncodeBase64(frame.data)}); err != nil {
			r.releaseReopen(owner, snapshot.managed)
			return err
		}
	}
	if err := owner.send("history_end", protocol.HistoryEndPayload{SessionID: snapshot.id, EndOffset: snapshot.end}); err != nil {
		r.releaseReopen(owner, snapshot.managed)
		return err
	}

	cursor := snapshot.end
	for {
		r.mu.Lock()
		managed := r.active[snapshot.id]
		if managed != snapshot.managed || managed.closed || managed.owner != owner || !managed.replaying {
			r.mu.Unlock()
			return errors.New("session reopen lost ownership")
		}
		start := managed.nextOffset
		if front := managed.history.Front(); front != nil {
			start = front.Value.(*historyEntry).offset
		}
		if cursor < start {
			r.mu.Unlock()
			r.releaseReopen(owner, managed)
			return protocol.NewError(protocol.BackpressureLimit, 1008, errors.New("replay history was evicted before delivery"))
		}
		end := managed.nextOffset
		if cursor == end {
			managed.replaying = false
			r.mu.Unlock()
			return nil
		}
		frames, ok := historyRangeLocked(managed, cursor, end)
		r.mu.Unlock()
		if !ok {
			r.releaseReopen(owner, managed)
			return protocol.NewError(protocol.BackpressureLimit, 1008, errors.New("replay history is no longer contiguous"))
		}
		for _, frame := range frames {
			if err := owner.send("terminal_output", protocol.TerminalOutputPayload{SessionID: snapshot.id, Offset: frame.offset, Data: protocol.EncodeBase64(frame.data)}); err != nil {
				r.releaseReopen(owner, managed)
				return err
			}
			cursor = frame.offset + uint64(len(frame.data))
		}
	}
}

func historyRangeLocked(managed *managedSession, start, end uint64) ([]historyFrame, bool) {
	cursor := start
	var frames []historyFrame
	for element := managed.history.Front(); element != nil && cursor < end; element = element.Next() {
		entry := element.Value.(*historyEntry)
		entryEnd := entry.offset + uint64(len(entry.data))
		if entryEnd <= cursor {
			continue
		}
		if entry.offset > cursor {
			return nil, false
		}
		offset := int(cursor - entry.offset)
		length := len(entry.data) - offset
		if remaining := int(end - cursor); length > remaining {
			length = remaining
		}
		data := append([]byte(nil), entry.data[offset:offset+length]...)
		frames = append(frames, historyFrame{offset: cursor, data: data})
		cursor += uint64(length)
	}
	return frames, cursor == end
}

func (r *sessionRegistry) releaseReopen(owner *connection, managed *managedSession) {
	r.mu.Lock()
	if r.active[managed.id] == managed && !managed.closed && managed.owner == owner && managed.replaying {
		managed.owner = nil
		managed.detached = true
		managed.replaying = false
	}
	r.mu.Unlock()
}

func (r *sessionRegistry) revokeCredential(credentialID string) error {
	r.mu.Lock()
	if r.revokedCredentials == nil {
		r.revokedCredentials = make(map[string]struct{})
	}
	r.revokedCredentials[credentialID] = struct{}{}
	managed := r.sessionsForCredentialLocked(credentialID)
	r.mu.Unlock()
	return r.closeSessions(managed, "credential_revoked")
}

func (r *sessionRegistry) expireCredential(credentialID string) error {
	r.mu.Lock()
	managed := r.sessionsForCredentialLocked(credentialID)
	r.mu.Unlock()
	return r.closeSessions(managed, "credential_expired")
}

func (r *sessionRegistry) sessionsForCredentialLocked(credentialID string) []*managedSession {
	managed := make([]*managedSession, 0)
	for _, session := range r.active {
		if session.credentialID == credentialID {
			managed = append(managed, session)
		}
	}
	return managed
}

func (r *sessionRegistry) closeSessions(managed []*managedSession, reason string) error {
	var errs []error
	for _, session := range managed {
		if err := r.closeManaged(session, reason); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (r *sessionRegistry) closeBy(owner *connection, id, reason string) error {
	r.mu.Lock()
	managed, err := r.owned(owner, id)
	r.mu.Unlock()
	if err != nil {
		return protocol.NewError(protocol.InvalidState, 1008, err)
	}
	return r.closeManaged(managed, reason)
}

func (r *sessionRegistry) close(reason string) error {
	r.mu.Lock()
	managed := make([]*managedSession, 0, len(r.active))
	for _, session := range r.active {
		managed = append(managed, session)
	}
	r.mu.Unlock()
	return r.closeSessions(managed, reason)
}

func (r *sessionRegistry) shutdown() error {
	r.mu.Lock()
	r.shuttingDown = true
	pending := make([]context.CancelFunc, 0, len(r.pending))
	for open := range r.pending {
		pending = append(pending, open.cancel)
	}
	managed := make([]*managedSession, 0, len(r.active))
	for _, session := range r.active {
		managed = append(managed, session)
	}
	r.mu.Unlock()
	for _, cancel := range pending {
		cancel()
	}
	var errs []error
	for _, session := range managed {
		if err := r.closeManagedMode(session, "agent_shutdown", false); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

func (r *sessionRegistry) disconnected(owner *connection, destroy ...bool) {
	shouldDestroy := len(destroy) > 0 && destroy[0]
	r.mu.Lock()
	pending := make([]context.CancelFunc, 0)
	for open := range r.pending {
		if open.owner == owner {
			pending = append(pending, open.cancel)
		}
	}
	managed := make([]*managedSession, 0, 1)
	for _, session := range r.active {
		if session.owner != owner {
			continue
		}
		if shouldDestroy {
			managed = append(managed, session)
		} else {
			session.owner = nil
			session.detached = true
			session.replaying = false
		}
	}
	r.mu.Unlock()
	for _, cancel := range pending {
		cancel()
	}
	for _, session := range managed {
		_ = r.closeManaged(session, "protocol_error")
	}
}

func (r *sessionRegistry) owned(owner *connection, id string) (*managedSession, error) {
	managed := r.active[id]
	if managed == nil || managed.owner != owner || managed.detached || managed.replaying || managed.closed {
		return nil, errors.New("terminal session is not attached to this connection")
	}
	return managed, nil
}

func (r *sessionRegistry) credentialRevokedLocked(credentialID string) bool {
	_, revoked := r.revokedCredentials[credentialID]
	return revoked
}

func (r *sessionRegistry) copyOutput(managed *managedSession) {
	buffer := make([]byte, protocol.MaxTerminalOutput)
	for {
		n, err := managed.terminal.Read(buffer)
		if n > 0 {
			chunk := append([]byte(nil), buffer[:n]...)
			r.mu.Lock()
			offset, appended := r.appendHistoryLocked(managed, chunk)
			owner := managed.owner
			replaying := managed.replaying
			r.mu.Unlock()
			if !appended {
				_ = r.closeManaged(managed, "protocol_error")
				return
			}
			if owner != nil && !replaying {
				if sendErr := owner.send("terminal_output", protocol.TerminalOutputPayload{SessionID: managed.id, Offset: offset, Data: protocol.EncodeBase64(chunk)}); sendErr != nil {
					if code, _, ok := protocol.ErrorDetails(sendErr); ok && code == protocol.BackpressureLimit {
						_ = r.closeManaged(managed, "backpressure_limit")
						return
					}
					r.detachAfterTransportSendFailure(managed, owner)
				}
			}
		}
		if err != nil {
			_ = r.closeManaged(managed, "process_exit")
			return
		}
	}
}

func (r *sessionRegistry) detachAfterTransportSendFailure(managed *managedSession, owner *connection) {
	r.mu.Lock()
	if r.active[managed.id] == managed && !managed.closed && managed.owner == owner {
		managed.owner = nil
		managed.detached = true
		managed.replaying = false
	}
	r.mu.Unlock()
}

func (r *sessionRegistry) appendHistoryLocked(managed *managedSession, data []byte) (uint64, bool) {
	if managed.closed || len(data) == 0 || managed.nextOffset > protocol.MaxSequence-uint64(len(data)) {
		return 0, false
	}
	offset := managed.nextOffset
	managed.nextOffset += uint64(len(data))
	entry := &historyEntry{session: managed, offset: offset, data: append([]byte(nil), data...)}
	entry.sessionElement = managed.history.PushBack(entry)
	entry.globalElement = r.history.PushBack(entry)
	managed.historyBytes += len(entry.data)
	r.historyBytes += len(entry.data)
	for managed.historyBytes > protocol.MaxSessionHistory {
		r.evictEntryBytesLocked(managed.history.Front().Value.(*historyEntry), managed.historyBytes-protocol.MaxSessionHistory)
	}
	for r.historyBytes > protocol.MaxAgentHistory {
		r.evictEntryBytesLocked(r.history.Front().Value.(*historyEntry), r.historyBytes-protocol.MaxAgentHistory)
	}
	return offset, true
}

func (r *sessionRegistry) evictEntryBytesLocked(entry *historyEntry, count int) {
	if count <= 0 {
		return
	}
	if count >= len(entry.data) {
		count = len(entry.data)
		clear(entry.data)
		entry.session.history.Remove(entry.sessionElement)
		r.history.Remove(entry.globalElement)
		entry.sessionElement = nil
		entry.globalElement = nil
		entry.data = nil
	} else {
		clear(entry.data[:count])
		entry.data = entry.data[count:]
		entry.offset += uint64(count)
	}
	entry.session.historyBytes -= count
	r.historyBytes -= count
}

func (r *sessionRegistry) removeHistoryLocked(managed *managedSession) {
	for managed.history.Front() != nil {
		entry := managed.history.Front().Value.(*historyEntry)
		r.evictEntryBytesLocked(entry, len(entry.data))
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
	r.removeHistoryLocked(managed)
	r.mu.Unlock()
	managed.cancel()
	err := managed.terminal.Close()
	r.mu.Lock()
	managed.closeErr = err
	if r.active[managed.id] == managed {
		delete(r.active, managed.id)
	}
	r.mu.Unlock()
	if notify && owner != nil && owner.sessionState() == protocol.SessionOpen {
		_ = owner.send("session_closed", protocol.SessionClosedPayload{SessionID: managed.id, Reason: reason})
	}
	close(managed.closeDone)
	return err
}
