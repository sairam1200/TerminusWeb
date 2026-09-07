package intelligence

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/mail"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	_ "github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/crypto/bcrypt"
	"terminus/windows-agent/internal/endpoint"
	"terminus/windows-agent/internal/protocol"
)

type Privacy struct {
	History         bool `json:"history"`
	Analytics       bool `json:"analytics"`
	Personalization bool `json:"personalization"`
}
type User struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}
type Snapshot struct {
	SessionID     string  `json:"sessionId"`
	Identity      string  `json:"identity"`
	User          *User   `json:"user"`
	Privacy       Privacy `json:"privacy"`
	RetentionDays int     `json:"retentionDays"`
	Admin         bool    `json:"admin"`
}
type CommandEvent struct {
	ID         string `json:"id"`
	Command    string `json:"command"`
	Category   string `json:"category"`
	Purpose    string `json:"purpose"`
	CreatedAt  string `json:"createdAt"`
	Status     string `json:"status"`
	ExitCode   *int   `json:"exitCode"`
	DurationMS *int   `json:"durationMs"`
}
type TopCommand struct {
	Command string `json:"command"`
	Count   int64  `json:"count"`
}
type Usage struct {
	Sessions                  int64        `json:"sessions"`
	Commands                  int64        `json:"commands"`
	TerminalTimeMS            int64        `json:"terminalTimeMs"`
	RecommendationImpressions int64        `json:"recommendationImpressions"`
	RecommendationClicks      int64        `json:"recommendationClicks"`
	InputTokens               int64        `json:"inputTokens"`
	OutputTokens              int64        `json:"outputTokens"`
	TotalTokens               int64        `json:"totalTokens"`
	AIRequests                int64        `json:"aiRequests"`
	TokenLimit                int64        `json:"tokenLimit"`
	RemainingTokens           int64        `json:"remainingTokens"`
	TopCommands               []TopCommand `json:"topCommands"`
}
type Service struct {
	db                *sql.DB
	admins            map[string]bool
	model             *localModel
	mu                sync.Mutex
	attempts          map[string]attempt
	connected         map[string]time.Time
	stop              chan struct{}
	done              chan struct{}
	activeConnections func() int64
}
type attempt struct {
	since time.Time
	count int
}
type session struct {
	Snapshot
	owner      string
	quotaOwner string
}

func Open(ctx context.Context, databaseURL, adminIDs, ollamaURL, model string) (*Service, error) {
	if databaseURL == "" {
		return nil, errors.New("intelligence database configuration required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, errors.New("intelligence unavailable")
	}
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(4)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err = db.PingContext(ctx); err != nil {
		db.Close()
		return nil, errors.New("intelligence unavailable")
	}
	var exists bool
	if err = db.QueryRowContext(ctx, "SELECT to_regclass('terminus_intelligence.sessions') IS NOT NULL").Scan(&exists); err != nil || !exists {
		db.Close()
		return nil, errors.New("intelligence migration required")
	}
	s := &Service{db: db, admins: map[string]bool{}, attempts: map[string]attempt{}, connected: map[string]time.Time{}, stop: make(chan struct{}), done: make(chan struct{})}
	for _, id := range strings.Split(adminIDs, ",") {
		id = strings.TrimSpace(id)
		if protocol.ValidUUID(id) {
			s.admins[id] = true
		}
	}
	if ollamaURL != "" {
		s.model, err = newLocalModel(ollamaURL, model)
		if err != nil {
			db.Close()
			return nil, err
		}
	}
	go s.maintenanceLoop()
	return s, nil
}
func (s *Service) Close() error { close(s.stop); <-s.done; return s.db.Close() }

func uuid() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("secure randomness unavailable")
	}
	b[6] = b[6]&15 | 64
	b[8] = b[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func decode(raw []byte, target any) error {
	if !utf8.Valid(raw) || len(raw) == 0 || raw[0] != '{' {
		return errors.New("invalid")
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("invalid")
	}
	return nil
}
func textOK(value string, max int) bool {
	if !utf8.ValidString(value) || len([]rune(value)) > max {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// All operations resolve ownership from the protected credential/device. The
// application session row and owner are locked before reading or modifying data.
func (s *Service) current(ctx context.Context, tx *sql.Tx, p endpoint.IntelligencePrincipal) (session, error) {
	var out session
	if p.CredentialID == "" || p.DeviceID == "" {
		return out, errors.New("identity required")
	}
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", p.CredentialID+"|"+p.DeviceID); err != nil {
		return out, err
	}
	var expires, last time.Time
	var account sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT s.id,s.owner_id,s.expires_at,o.last_seen_at,o.account_id FROM terminus_intelligence.sessions s JOIN terminus_intelligence.owners o ON o.id=s.owner_id WHERE s.credential_id=$1 AND s.device_id=$2 FOR UPDATE OF s,o`, p.CredentialID, p.DeviceID).Scan(&out.SessionID, &out.owner, &expires, &last, &account)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return out, err
	}
	if errors.Is(err, sql.ErrNoRows) || !time.Now().Before(expires) || (!account.Valid && time.Since(last) > 7*24*time.Hour) {
		out.SessionID, out.owner = uuid(), uuid()
		if _, err := tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.owners(id) VALUES($1)`, out.owner); err != nil {
			return out, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.sessions(id,credential_id,device_id,owner_id) VALUES($1,$2,$3,$4) ON CONFLICT(credential_id,device_id) DO UPDATE SET id=excluded.id,owner_id=excluded.owner_id,created_at=now(),last_seen_at=now(),expires_at=now()+interval '30 days'`, out.SessionID, p.CredentialID, p.DeviceID, out.owner)
		if err != nil {
			return out, err
		}
	}
	err = tx.QueryRowContext(ctx, `SELECT owner_id FROM terminus_intelligence.quota_principals WHERE credential_id=$1 AND device_id=$2`, p.CredentialID, p.DeviceID).Scan(&out.quotaOwner)
	if errors.Is(err, sql.ErrNoRows) {
		out.quotaOwner = uuid()
		if _, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.owners(id) VALUES($1)`, out.quotaOwner); err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.quota_principals(credential_id,device_id,owner_id) VALUES($1,$2,$3)`, p.CredentialID, p.DeviceID, out.quotaOwner)
		}
	}
	if err != nil {
		return out, err
	}
	return s.snapshot(ctx, tx, out, p)
}
func (s *Service) snapshot(ctx context.Context, tx *sql.Tx, out session, p endpoint.IntelligencePrincipal) (session, error) {
	var uid, email, name sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT o.history,o.analytics,o.personalization,a.id,a.email,a.name FROM terminus_intelligence.owners o LEFT JOIN terminus_intelligence.accounts a ON a.id=o.account_id WHERE o.id=$1 FOR UPDATE OF o`, out.owner).Scan(&out.Privacy.History, &out.Privacy.Analytics, &out.Privacy.Personalization, &uid, &email, &name)
	if err != nil {
		return out, err
	}
	out.Identity = "guest"
	out.User = nil
	if uid.Valid {
		out.Identity = "authenticated"
		out.User = &User{uid.String, email.String, name.String}
	}
	out.RetentionDays = 30
	out.Admin = s.admins[p.CredentialID]
	_, err = tx.ExecContext(ctx, `UPDATE terminus_intelligence.sessions SET last_seen_at=now() WHERE id=$1`, out.SessionID)
	if err != nil {
		return out, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE terminus_intelligence.owners SET last_seen_at=now() WHERE id=$1`, out.owner)
	return out, err
}

func (s *Service) Call(ctx context.Context, p endpoint.IntelligencePrincipal, method string, raw json.RawMessage) (any, string) {
	// Validate method-specific closed shapes before acquiring database resources.
	var params struct {
		EventID         string  `json:"eventId"`
		Command         string  `json:"command"`
		Query           *string `json:"query"`
		Category        *string `json:"category"`
		Limit           *int    `json:"limit"`
		Cursor          *string `json:"cursor"`
		ID              string  `json:"id"`
		State           string  `json:"state"`
		Email           string  `json:"email"`
		Password        string  `json:"password"`
		Name            string  `json:"name"`
		History         *bool   `json:"history"`
		Analytics       *bool   `json:"analytics"`
		Personalization *bool   `json:"personalization"`
	}
	allowed := map[string]string{"session.current": "", "privacy.update": "history,analytics,personalization", "command.record": "eventId,command", "history.list": "query,category,limit", "history.delete": "", "analytics.delete": "", "guest.delete": "", "data.export": "cursor", "recommendations.get": "query", "recommendation.click": "id", "terminal.record": "eventId,state", "usage.get": "", "account.register": "email,password,name", "account.login": "email,password", "account.logout": "", "billing.get": "", "admin.overview": ""}
	fields, exists := allowed[method]
	if !exists || decode(raw, &params) != nil {
		return nil, "INVALID_REQUEST"
	}
	var keys map[string]json.RawMessage
	if json.Unmarshal(raw, &keys) != nil || keys == nil {
		return nil, "INVALID_REQUEST"
	}
	for key, value := range keys {
		if !strings.Contains(","+fields+",", ","+key+",") || string(value) == "null" {
			return nil, "INVALID_REQUEST"
		}
	}
	if params.Query != nil && !textOK(*params.Query, 256) {
		return nil, "INVALID_REQUEST"
	}
	if params.Category != nil && !textOK(*params.Category, 64) {
		return nil, "INVALID_REQUEST"
	}
	if params.Limit != nil && (*params.Limit < 1 || *params.Limit > 100) {
		return nil, "INVALID_REQUEST"
	}
	if params.Cursor != nil && !protocol.ValidUUID(*params.Cursor) {
		return nil, "INVALID_REQUEST"
	}
	if method == "privacy.update" && (params.History == nil || params.Analytics == nil || params.Personalization == nil || (*params.Personalization && !*params.History)) {
		return nil, "INVALID_REQUEST"
	}
	if (method == "command.record" || method == "terminal.record") && !protocol.ValidUUID(params.EventID) {
		return nil, "INVALID_REQUEST"
	}
	if method == "terminal.record" && params.State != "connected" && params.State != "disconnected" && params.State != "reconnecting" {
		return nil, "INVALID_REQUEST"
	}
	var sanitized Recommendation
	if method == "command.record" {
		var ok bool
		sanitized, ok = sanitize(params.Command)
		if !ok {
			return nil, "INVALID_REQUEST"
		}
	}
	if method == "account.register" || method == "account.login" {
		params.Email = strings.ToLower(strings.TrimSpace(params.Email))
		address, err := mail.ParseAddress(params.Email)
		if err != nil || address.Address != params.Email || len(params.Email) > 320 || len(params.Password) < 12 || len(params.Password) > 1024 || !utf8.ValidString(params.Password) || !textOK(params.Email, 320) {
			return nil, "INVALID_REQUEST"
		}
		if method == "account.register" && (strings.TrimSpace(params.Name) == "" || !textOK(params.Name, 120)) {
			return nil, "INVALID_REQUEST"
		}
		if !s.allowLogin(p.CredentialID) {
			return nil, "RATE_LIMITED"
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, "UNAVAILABLE"
	}
	defer tx.Rollback()
	sess, err := s.current(ctx, tx, p)
	if err != nil {
		return nil, "UNAVAILABLE"
	}
	var result any
	switch method {
	case "session.current":
		result = sess.Snapshot
	case "privacy.update":
		_, err = tx.ExecContext(ctx, `UPDATE terminus_intelligence.owners SET history=$2,analytics=$3,personalization=$4 WHERE id=$1`, sess.owner, *params.History, *params.Analytics, *params.Personalization)
		if err == nil {
			sess, err = s.snapshot(ctx, tx, sess, p)
		}
		result = sess.Snapshot
	case "command.record":
		if !sess.Privacy.History {
			return nil, "CONSENT_REQUIRED"
		}
		var stamp time.Time
		err = tx.QueryRowContext(ctx, `INSERT INTO terminus_intelligence.command_events(owner_id,event_id,command,category,purpose) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING created_at`, sess.owner, params.EventID, sanitized.Command, sanitized.Category, sanitized.Purpose).Scan(&stamp)
		if errors.Is(err, sql.ErrNoRows) {
			err = nil
			result = map[string]any{"recorded": false, "event": nil}
		} else {
			result = map[string]any{"recorded": true, "event": CommandEvent{params.EventID, sanitized.Command, sanitized.Category, sanitized.Purpose, stamp.UTC().Format(time.RFC3339Nano), "submitted", nil, nil}}
		}
	case "history.list":
		limit := 50
		if params.Limit != nil {
			limit = *params.Limit
		}
		var items []CommandEvent
		items, err = s.history(ctx, tx, sess.owner, params.Query, params.Category, limit)
		result = map[string]any{"items": items}
	case "history.delete", "analytics.delete":
		table := "command_events"
		if method == "analytics.delete" {
			table = "analytics_events"
		}
		_, err = tx.ExecContext(ctx, "DELETE FROM terminus_intelligence."+table+" WHERE owner_id=$1", sess.owner)
		result = map[string]bool{"deleted": true}
	case "guest.delete", "account.logout":
		if method == "guest.delete" && sess.Identity != "guest" {
			return nil, "FORBIDDEN"
		}
		if method == "guest.delete" {
			if _, err = tx.ExecContext(ctx, `DELETE FROM terminus_intelligence.command_events WHERE owner_id=$1`, sess.owner); err == nil {
				_, err = tx.ExecContext(ctx, `DELETE FROM terminus_intelligence.analytics_events WHERE owner_id=$1`, sess.owner)
			}
			if err == nil {
				_, err = tx.ExecContext(ctx, `UPDATE terminus_intelligence.owners SET history=false,analytics=false,personalization=false WHERE id=$1`, sess.owner)
			}
		}
		if err == nil {
			sess, err = s.freshGuest(ctx, tx, sess, p)
		}
		result = sess.Snapshot
	case "usage.get", "billing.get", "data.export":
		var usage Usage
		usage, err = s.usage(ctx, tx, sess.owner, sess.quotaOwner)
		if method == "billing.get" {
			result = map[string]any{"plan": "Personal prototype", "commercialEnabled": false, "tokenLimit": usage.TokenLimit, "tokensUsed": usage.TotalTokens}
		} else if method == "usage.get" {
			result = usage
		} else {
			var items []CommandEvent
			var next *string
			if err == nil {
				items, next, err = s.exportPage(ctx, tx, sess.owner, params.Cursor)
			}
			if errors.Is(err, sql.ErrNoRows) {
				return nil, "NOT_FOUND"
			}
			result = map[string]any{"session": sess.Snapshot, "history": items, "usage": usage, "nextCursor": next}
		}
	case "recommendation.click", "terminal.record":
		if method == "recommendation.click" {
			found := false
			for _, entry := range catalog {
				if entry.ID == params.ID {
					found = true
				}
			}
			if !found {
				return nil, "NOT_FOUND"
			}
		}
		recorded := false
		if sess.Privacy.Analytics {
			eventID, kind, reference, duration := params.EventID, "terminal."+params.State, "", int64(0)
			if method == "recommendation.click" {
				eventID, kind, reference = uuid(), "recommendation.click", params.ID
			} else {
				duration = s.connectionDuration(p, params.State)
			}
			var res sql.Result
			res, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.analytics_events(owner_id,event_id,kind,reference_id,duration_ms) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, sess.owner, eventID, kind, reference, duration)
			if err == nil {
				n, _ := res.RowsAffected()
				recorded = n == 1
			}
		}
		result = map[string]bool{"recorded": recorded}
	case "recommendations.get":
		preferred := map[string]int{}
		if sess.Privacy.History && sess.Privacy.Personalization {
			var items []CommandEvent
			items, err = s.history(ctx, tx, sess.owner, nil, nil, 100)
			for _, item := range items {
				preferred[item.Command]++
			}
		}
		query := ""
		if params.Query != nil {
			query = *params.Query
		}
		items := retrieve(query, preferred)
		if sess.Privacy.Analytics && err == nil {
			for _, entry := range items {
				_, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.analytics_events(owner_id,event_id,kind,reference_id) VALUES($1,$2,'recommendation.impression',$3)`, sess.owner, uuid(), entry.ID)
				if err != nil {
					break
				}
			}
		}
		if err != nil {
			return nil, "UNAVAILABLE"
		}
		if err = tx.Commit(); err != nil {
			return nil, "UNAVAILABLE"
		}
		// Models receive catalog documents only. Query and history remain local.
		mode := "catalog"
		if s.model != nil && len(items) > 0 {
			var code string
			items, mode, code = s.explain(ctx, sess.quotaOwner, items)
			if code != "" {
				return nil, code
			}
		}
		return map[string]any{"items": items, "mode": mode}, ""
	case "account.register", "account.login":
		if sess.Identity != "guest" {
			return nil, "CONFLICT"
		}
		sess, err = s.account(ctx, tx, sess, p, method, params.Email, params.Password, params.Name)
		result = sess.Snapshot
		if errors.Is(err, errAccount) {
			return nil, "UNAUTHORIZED"
		}
		if errors.Is(err, errConflict) {
			return nil, "CONFLICT"
		}
	case "admin.overview":
		if !sess.Admin {
			return nil, "FORBIDDEN"
		}
		result, err = s.admin(ctx, tx)
	}
	if err != nil {
		return nil, "UNAVAILABLE"
	}
	if err = tx.Commit(); err != nil {
		return nil, "UNAVAILABLE"
	}
	return result, ""
}

func (s *Service) history(ctx context.Context, tx *sql.Tx, owner string, query, category *string, limit int) ([]CommandEvent, error) {
	q, c := "", ""
	if query != nil {
		q = *query
	}
	if category != nil {
		c = *category
	}
	var sqlLimit any = limit
	if limit == 0 {
		sqlLimit = nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_id,command,category,purpose,created_at FROM terminus_intelligence.command_events WHERE owner_id=$1 AND expires_at>now() AND ($2='' OR strpos(lower(command||' '||purpose),lower($2))>0) AND ($3='' OR category=$3) ORDER BY created_at DESC,event_id LIMIT $4`, owner, q, c, sqlLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CommandEvent{}
	for rows.Next() {
		var event CommandEvent
		var stamp time.Time
		if err := rows.Scan(&event.ID, &event.Command, &event.Category, &event.Purpose, &stamp); err != nil {
			return nil, err
		}
		event.CreatedAt = stamp.UTC().Format(time.RFC3339Nano)
		event.Status = "submitted"
		out = append(out, event)
	}
	return out, rows.Err()
}

func (s *Service) exportPage(ctx context.Context, tx *sql.Tx, owner string, cursor *string) ([]CommandEvent, *string, error) {
	var stamp any
	var eventID any
	if cursor != nil {
		var created time.Time
		if err := tx.QueryRowContext(ctx, `SELECT created_at FROM terminus_intelligence.command_events WHERE owner_id=$1 AND event_id=$2 AND expires_at>now()`, owner, *cursor).Scan(&created); err != nil {
			return nil, nil, err
		}
		stamp, eventID = created, *cursor
	}
	rows, err := tx.QueryContext(ctx, `SELECT event_id,command,category,purpose,created_at FROM terminus_intelligence.command_events WHERE owner_id=$1 AND expires_at>now() AND ($2::timestamptz IS NULL OR (created_at,event_id)<($2::timestamptz,$3::uuid)) ORDER BY created_at DESC,event_id DESC LIMIT 51`, owner, stamp, eventID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	items := []CommandEvent{}
	for rows.Next() {
		var e CommandEvent
		var created time.Time
		if err := rows.Scan(&e.ID, &e.Command, &e.Category, &e.Purpose, &created); err != nil {
			return nil, nil, err
		}
		e.CreatedAt = created.UTC().Format(time.RFC3339Nano)
		e.Status = "submitted"
		items = append(items, e)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	var next *string
	if len(items) > 50 {
		items = items[:50]
		id := items[49].ID
		next = &id
	}
	return items, next, nil
}
func (s *Service) freshGuest(ctx context.Context, tx *sql.Tx, old session, p endpoint.IntelligencePrincipal) (session, error) {
	out := session{owner: uuid(), quotaOwner: old.quotaOwner}
	out.SessionID = uuid()
	if _, err := tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.owners(id) VALUES($1)`, out.owner); err != nil {
		return out, err
	}
	_, err := tx.ExecContext(ctx, `UPDATE terminus_intelligence.sessions SET id=$2,owner_id=$3,created_at=now(),last_seen_at=now(),expires_at=now()+interval '30 days' WHERE id=$1`, old.SessionID, out.SessionID, out.owner)
	if err != nil {
		return out, err
	}
	s.mu.Lock()
	delete(s.connected, p.CredentialID+"\x00"+p.DeviceID)
	s.mu.Unlock()
	return s.snapshot(ctx, tx, out, p)
}

var errAccount = errors.New("account unavailable")
var errConflict = errors.New("account conflict")

func (s *Service) account(ctx context.Context, tx *sql.Tx, old session, p endpoint.IntelligencePrincipal, method, email, password, name string) (session, error) {
	var accountID, owner, hash string
	// Serialize registrations/logins for one account before reading its owner.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,1))`, email); err != nil {
		return old, err
	}
	if method == "account.register" {
		var exists bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM terminus_intelligence.accounts WHERE email=$1)`, email).Scan(&exists); err != nil {
			return old, err
		}
		if exists {
			return old, errConflict
		}
		encoded, err := bcrypt.GenerateFromPassword(passwordBytes(password), 12)
		if err != nil {
			return old, err
		}
		accountID, owner = uuid(), uuid()
		if _, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.accounts(id,email,password_hash,name) VALUES($1,$2,$3,$4)`, accountID, email, string(encoded), strings.TrimSpace(name)); err != nil {
			return old, err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.owners(id,account_id,history,analytics,personalization) VALUES($1,$2,$3,$4,$5)`, owner, accountID, old.Privacy.History, old.Privacy.Analytics, old.Privacy.Personalization); err != nil {
			return old, err
		}
	} else {
		err := tx.QueryRowContext(ctx, `SELECT a.id,a.password_hash,o.id FROM terminus_intelligence.accounts a JOIN terminus_intelligence.owners o ON o.account_id=a.id WHERE a.email=$1 FOR UPDATE OF o`, email).Scan(&accountID, &hash, &owner)
		if err != nil {
			_ = bcrypt.CompareHashAndPassword([]byte(dummyPasswordHash), passwordBytes(password))
			return old, errAccount
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), passwordBytes(password)) != nil {
			return old, errAccount
		}
	}
	// Only this credential's eligible guest history is linked, and only when the
	// destination account still permits collection. No IDs come from the browser.
	var history bool
	if err := tx.QueryRowContext(ctx, `SELECT history FROM terminus_intelligence.owners WHERE id=$1`, owner).Scan(&history); err != nil {
		return old, err
	}
	if old.Privacy.History && history {
		_, err := tx.ExecContext(ctx, `INSERT INTO terminus_intelligence.command_events(owner_id,event_id,command,category,purpose,created_at,expires_at) SELECT $2,event_id,command,category,purpose,created_at,expires_at FROM terminus_intelligence.command_events WHERE owner_id=$1 AND expires_at>now() ON CONFLICT DO NOTHING`, old.owner, owner)
		if err != nil {
			return old, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM terminus_intelligence.command_events WHERE owner_id=$1`, old.owner); err != nil {
		return old, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM terminus_intelligence.analytics_events WHERE owner_id=$1`, old.owner); err != nil {
		return old, err
	}
	newID := uuid()
	if _, err := tx.ExecContext(ctx, `UPDATE terminus_intelligence.sessions SET id=$2,owner_id=$3,created_at=now(),expires_at=now()+interval '30 days' WHERE id=$1`, old.SessionID, newID, owner); err != nil {
		return old, err
	}
	old.SessionID, old.owner = newID, owner
	return s.snapshot(ctx, tx, old, p)
}

const dummyPasswordHash = "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW"

// Version 1: domain-separated SHA256, base64, bcrypt cost 12. Prehashing
// preserves all 1024 allowed UTF-8 bytes without bcrypt's 72-byte truncation.
func passwordBytes(password string) []byte {
	digest := sha256.Sum256([]byte("Terminus/intelligence/password/v1\x00" + password))
	return []byte(base64.RawStdEncoding.EncodeToString(digest[:]))
}

func (s *Service) allowLogin(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	a := s.attempts[id]
	if time.Since(a.since) > 5*time.Minute {
		a = attempt{since: time.Now()}
	}
	a.count++
	s.attempts[id] = a
	return a.count <= 5
}
func (s *Service) connectionDuration(p endpoint.IntelligencePrincipal, state string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := p.CredentialID + "\x00" + p.DeviceID
	if state == "connected" {
		s.connected[key] = time.Now()
		return 0
	}
	start, ok := s.connected[key]
	delete(s.connected, key)
	if !ok {
		return 0
	}
	return min(time.Since(start).Milliseconds(), 45000)
}
