package endpoint

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"fmt"
	"sync"
	"time"

	"terminus/windows-agent/internal/protocol"
)

const (
	pairingLifetime       = 120 * time.Second
	pairingApprovalLimit  = 60 * time.Second
	credentialLifetime    = 30 * 24 * time.Hour
	challengeLifetime     = 10 * time.Second
	authorizationLifetime = 12 * time.Hour
)

type Credential struct {
	ID        string
	Secret    [32]byte
	ExpiresAt time.Time
}

// CredentialStore is supplied by the consumer that owns the agent service
// identity. Implementations must protect records with the corresponding
// Windows user/machine protected-secret facility; the endpoint deliberately
// provides no plaintext or generic file-backed implementation.
type CredentialStore interface {
	Put(context.Context, Credential) error
	Get(context.Context, string) (Credential, error)
	Delete(context.Context, string) error
}

type PairingApproval struct {
	Origin           string
	ClientInstanceID string
	DeviceIdentity   string
}

type ApprovePairing func(context.Context, PairingApproval) bool

type pairingCode struct {
	value    [16]byte
	expires  time.Time
	consumed bool
}

type pairingManager struct {
	mu     sync.Mutex
	active *pairingCode
}

func (m *pairingManager) issue(now time.Time) (string, time.Time, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", time.Time{}, fmt.Errorf("generate pairing code: %w", err)
	}
	expires := now.Add(pairingLifetime)
	m.mu.Lock()
	m.active = &pairingCode{value: value, expires: expires}
	m.mu.Unlock()
	return protocol.EncodeBase64(value[:]), expires, nil
}

// consume deliberately burns the active code on the first syntactically valid
// attempt, including a wrong attempt, so it cannot be brute-forced repeatedly.
func (m *pairingManager) consume(encoded string, now time.Time) bool {
	provided, valid := protocol.DecodeBase64(encoded, 16)
	if !valid {
		return false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.active == nil || m.active.consumed || !now.Before(m.active.expires) {
		return false
	}
	m.active.consumed = true
	return subtle.ConstantTimeCompare(provided, m.active.value[:]) == 1
}

type challenge struct {
	id      string
	value   [32]byte
	expires time.Time
	used    bool
}

func newChallenge(now time.Time) (*challenge, error) {
	id, err := randomUUID()
	if err != nil {
		return nil, err
	}
	result := &challenge{id: id, expires: now.Add(challengeLifetime)}
	if _, err := rand.Read(result.value[:]); err != nil {
		return nil, fmt.Errorf("generate challenge: %w", err)
	}
	return result, nil
}

func authProof(secret []byte, connectionID, challengeID string, challengeValue []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("Terminus/0.1/auth"))
	mac.Write([]byte{0})
	mac.Write([]byte(connectionID))
	mac.Write([]byte{0})
	mac.Write([]byte(challengeID))
	mac.Write([]byte{0})
	mac.Write(challengeValue)
	return mac.Sum(nil)
}

type failureWindow struct {
	started       time.Time
	count         int
	pending       int
	cooldownUntil time.Time
}

type rateLimiter struct {
	mu      sync.Mutex
	windows map[string]failureWindow
}

func newRateLimiter() *rateLimiter { return &rateLimiter{windows: make(map[string]failureWindow)} }

func (r *rateLimiter) allowed(identity string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	w := r.windows[identity]
	if !w.cooldownUntil.IsZero() {
		if now.Before(w.cooldownUntil) {
			return false
		}
		w = failureWindow{started: now}
	} else if !w.started.IsZero() && now.Sub(w.started) >= 5*time.Minute {
		w = failureWindow{started: now}
	}
	r.windows[identity] = w
	return w.count+w.pending < 5
}

func (r *rateLimiter) begin(identity string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	w := r.windows[identity]
	if !w.cooldownUntil.IsZero() {
		if now.Before(w.cooldownUntil) {
			return false
		}
		w = failureWindow{started: now}
	} else if w.started.IsZero() || now.Sub(w.started) >= 5*time.Minute {
		w = failureWindow{started: now}
	}
	if w.count+w.pending >= 5 {
		r.windows[identity] = w
		return false
	}
	w.pending++
	r.windows[identity] = w
	return true
}

func (r *rateLimiter) finish(identity string, now time.Time, success bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	w := r.windows[identity]
	if w.pending > 0 {
		w.pending--
	}
	if !success {
		w.count++
		if w.count >= 5 {
			w.cooldownUntil = now.Add(5 * time.Minute)
		}
	}
	r.windows[identity] = w
}

func randomUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}
