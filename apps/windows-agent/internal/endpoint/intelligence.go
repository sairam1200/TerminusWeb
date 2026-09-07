package endpoint

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"
	"terminus/windows-agent/internal/protocol"
)

const IntelligenceSubprotocol = "terminus.intelligence.v1"

type IntelligencePrincipal struct{ CredentialID, DeviceID string }
type IntelligenceRPC interface {
	Call(context.Context, IntelligencePrincipal, string, json.RawMessage) (any, string)
}

// IntelligenceHandler shares the terminal host's identity and revocation fence.
// The optional service never changes terminal admission or availability.
func (e *Endpoint) IntelligenceHandler(service IntelligenceRPC) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if service == nil {
			http.Error(w, "unavailable", 503)
			return
		}
		if r.URL.Path != "/intelligence" || r.Method != http.MethodGet {
			http.NotFound(w, r)
			return
		}
		if r.TLS == nil || r.URL.RawQuery != "" || r.URL.Fragment != "" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" || !exactOrigin(r.Header.Values("Origin"), e.cfg.AllowedOrigin) {
			http.Error(w, "rejected", 403)
			return
		}
		if values := r.Header.Values("Sec-WebSocket-Protocol"); len(values) != 1 || values[0] != IntelligenceSubprotocol {
			http.Error(w, "subprotocol required", 426)
			return
		}
		device, err := e.cfg.ResolveDevice(r)
		if err != nil || strings.TrimSpace(device) == "" {
			http.Error(w, "rejected", 403)
			return
		}
		if !e.limiter.begin(device, e.cfg.Now()) {
			http.Error(w, "unavailable", 429)
			return
		}
		attemptFinished := false
		defer func() {
			if !attemptFinished {
				e.limiter.finish(device, e.cfg.Now(), false)
			}
		}()
		upgrade := websocket.Upgrader{Subprotocols: []string{IntelligenceSubprotocol}, CheckOrigin: func(*http.Request) bool { return true }}
		ws, err := upgrade.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer ws.Close()
		ws.SetReadLimit(65536)
		ch, err := newChallenge(e.cfg.Now())
		if err != nil {
			return
		}
		id, err := randomUUID()
		if err != nil {
			return
		}
		ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if ws.WriteJSON(map[string]any{"type": "challenge", "connectionId": id, "challengeId": ch.id, "challenge": protocol.EncodeBase64(ch.value[:]), "expiresAt": protocol.FormatTimestamp(ch.expires)}) != nil {
			return
		}
		ws.SetReadDeadline(ch.expires)
		typ, raw, err := ws.ReadMessage()
		if err != nil || typ != websocket.TextMessage {
			return
		}
		var auth struct {
			Type         string `json:"type"`
			CredentialID string `json:"credentialId"`
			Proof        string `json:"proof"`
		}
		if strictIntelligenceJSON(raw, &auth) != nil || auth.Type != "authenticate" || !protocol.ValidUUID(auth.CredentialID) || !e.cfg.Now().Before(ch.expires) {
			return
		}
		cred, err := e.intelligenceCredential(auth.CredentialID, device)
		if err != nil {
			return
		}
		proof, ok := protocol.DecodeBase64(auth.Proof, 32)
		if !ok || !hmac.Equal(proof, intelligenceProof(cred.Secret[:], id, ch.id, ch.value[:])) {
			return
		}
		if !e.cfg.Now().Before(ch.expires) {
			return
		}
		deadline := minTime(e.cfg.Now().Add(12*time.Hour), cred.ExpiresAt)
		ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if ws.WriteJSON(map[string]string{"type": "ready"}) != nil {
			return
		}
		e.limiter.finish(device, e.cfg.Now(), true)
		attemptFinished = true
		e.mu.Lock()
		e.intelligenceActive++
		e.mu.Unlock()
		defer func() { e.mu.Lock(); e.intelligenceActive--; e.mu.Unlock() }()
		// One synchronous RPC at a time is below the five-active-request maximum.
		// Control writes are explicitly concurrency-safe in gorilla/websocket.
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		var writes sync.Mutex
		go func() {
			ticker := time.NewTicker(time.Second)
			defer ticker.Stop()
			ticks := 0
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					if !e.cfg.Now().Before(deadline) {
						ws.Close()
						cancel()
						return
					}
					if _, err := e.intelligenceCredential(cred.ID, device); err != nil {
						ws.Close()
						cancel()
						return
					}
					ticks++
					if ticks%15 == 0 {
						if ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)) != nil {
							ws.Close()
							cancel()
							return
						}
					}
				}
			}
		}()
		ws.SetReadDeadline(time.Now().Add(45 * time.Second))
		ws.SetPongHandler(func(string) error { return ws.SetReadDeadline(time.Now().Add(45 * time.Second)) })
		window, count := time.Now(), 0
		for {
			typ, raw, err := ws.ReadMessage()
			if err != nil || typ != websocket.TextMessage {
				return
			}
			var req struct {
				Type   string          `json:"type"`
				ID     string          `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if strictIntelligenceJSON(raw, &req) != nil || req.Type != "request" || !protocol.ValidUUID(req.ID) || len(req.Params) == 0 {
				return
			}
			if !e.cfg.Now().Before(deadline) {
				return
			}
			if _, err := e.intelligenceCredential(cred.ID, device); err != nil {
				return
			}
			if time.Since(window) >= time.Minute {
				window, count = time.Now(), 0
			}
			count++
			var data any
			code := ""
			if count > 120 {
				code = "RATE_LIMITED"
			} else {
				callCtx, done := context.WithTimeout(ctx, 9*time.Second)
				data, code = service.Call(callCtx, IntelligencePrincipal{cred.ID, device}, req.Method, req.Params)
				done()
			}
			if ctx.Err() != nil {
				return
			}
			result := map[string]any{"type": "result", "id": req.ID, "ok": code == ""}
			if code != "" {
				result["error"] = safeIntelligenceError(code)
			} else {
				result["data"] = data
			}
			encoded, marshalErr := json.Marshal(result)
			if marshalErr != nil || len(encoded) > 60*1024 {
				result = map[string]any{"type": "result", "id": req.ID, "ok": false, "error": "UNAVAILABLE"}
			}
			writes.Lock()
			ws.SetWriteDeadline(time.Now().Add(5 * time.Second))
			err = ws.WriteJSON(result)
			writes.Unlock()
			if err != nil {
				return
			}
		}
	})
}

func (e *Endpoint) IntelligenceActiveConnections() int64 {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.intelligenceActive
}

func safeIntelligenceError(code string) string {
	switch code {
	case "INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "UNAVAILABLE", "RATE_LIMITED", "CONSENT_REQUIRED", "CONFLICT", "QUOTA_EXCEEDED":
		return code
	}
	return "UNAVAILABLE"
}
func (e *Endpoint) intelligenceCredential(id, device string) (Credential, error) {
	e.mu.Lock()
	_, revoked := e.revokedCredentials[id]
	closed := e.closed
	e.mu.Unlock()
	if revoked || closed {
		return Credential{}, errors.New("unavailable")
	}
	cred, err := e.cfg.Credentials.Get(context.Background(), id)
	if err != nil || cred.ID != id || cred.DeviceIdentity == "" || cred.DeviceIdentity != device || !e.cfg.Now().Before(cred.ExpiresAt) {
		return Credential{}, errors.New("unavailable")
	}
	return cred, nil
}
func intelligenceProof(secret []byte, connectionID, challengeID string, value []byte) []byte {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("Terminus/intelligence/1/auth\x00"))
	mac.Write([]byte(connectionID))
	mac.Write([]byte{0})
	mac.Write([]byte(challengeID))
	mac.Write([]byte{0})
	mac.Write(value)
	return mac.Sum(nil)
}
func strictIntelligenceJSON(raw []byte, target any) error {
	if !utf8.Valid(raw) || len(raw) == 0 || raw[0] != '{' {
		return errors.New("invalid")
	}
	// Reject duplicate keys as well as unknown fields, including nested objects.
	d := json.NewDecoder(bytes.NewReader(raw))
	if err := uniqueJSONValue(d); err != nil {
		return err
	}
	if _, err := d.Token(); err != io.EOF {
		return errors.New("invalid")
	}
	d = json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func uniqueJSONValue(d *json.Decoder) error {
	t, err := d.Token()
	if err != nil {
		return err
	}
	delim, ok := t.(json.Delim)
	if !ok {
		return nil
	}
	if delim == '{' {
		keys := map[string]bool{}
		for d.More() {
			key, err := d.Token()
			if err != nil {
				return err
			}
			s, ok := key.(string)
			if !ok || keys[s] {
				return errors.New("duplicate")
			}
			keys[s] = true
			if err := uniqueJSONValue(d); err != nil {
				return err
			}
		}
	} else if delim == '[' {
		for d.More() {
			if err := uniqueJSONValue(d); err != nil {
				return err
			}
		}
	} else {
		return errors.New("invalid")
	}
	_, err = d.Token()
	return err
}
