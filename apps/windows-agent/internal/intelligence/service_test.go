package intelligence

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"terminus/windows-agent/internal/endpoint"
)

func testService(t *testing.T) *Service {
	t.Helper()
	url := os.Getenv("TERMINUS_INTELLIGENCE_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("actual PostgreSQL test requires TERMINUS_INTELLIGENCE_TEST_DATABASE_URL")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	s, err := Open(ctx, url, "", "", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func call(t *testing.T, s *Service, p endpoint.IntelligencePrincipal, method string, params any) any {
	t.Helper()
	raw, _ := json.Marshal(params)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	data, code := s.Call(ctx, p, method, raw)
	if code != "" {
		t.Fatalf("%s failed: %s", method, code)
	}
	return data
}
func reject(t *testing.T, s *Service, p endpoint.IntelligencePrincipal, method string, params any, want string) {
	t.Helper()
	raw, _ := json.Marshal(params)
	_, code := s.Call(context.Background(), p, method, raw)
	if code != want {
		t.Fatalf("%s got %s want %s", method, code, want)
	}
}
func identity() endpoint.IntelligencePrincipal {
	return endpoint.IntelligencePrincipal{CredentialID: uuid(), DeviceID: "synthetic-private-device"}
}

var consent = map[string]bool{"history": true, "analytics": true, "personalization": true}

func TestSanitizerDiscardsArgumentsAndUncertainCommands(t *testing.T) {
	tests := map[string]string{"git status --token=synthetic-private-value": "git status", "Get-ChildItem C:/private": "Get-ChildItem", "unknown secret": "[redacted command]", "git status; other": "[redacted command]", "git -c option status": "[redacted command]", "echo password": "[redacted command]"}
	for input, want := range tests {
		got, ok := sanitize(input)
		if !ok || got.Command != want {
			t.Fatalf("sanitization did not match reviewed template")
		}
	}
	for _, input := range []string{"", "git status\n", strings.Repeat("x", 4097), "test\x00"} {
		if _, ok := sanitize(input); ok {
			t.Fatal("invalid command accepted")
		}
	}
	for _, item := range retrieve("", nil) {
		if item.SourceURL == "" || item.Risk != "read" {
			t.Fatal("unreviewed catalog item")
		}
	}
}

func TestPostgresConsentIsolationAccountsAndDeletion(t *testing.T) {
	s := testService(t)
	a, b := identity(), identity()
	empty := map[string]any{}
	first := call(t, s, a, "session.current", empty).(Snapshot)
	if first.Identity != "guest" || first.Privacy.History || first.User != nil {
		t.Fatal("unsafe guest defaults")
	}
	record := map[string]string{"eventId": uuid(), "command": "git status --credential=synthetic-private-value"}
	reject(t, s, a, "command.record", record, "CONSENT_REQUIRED")
	call(t, s, a, "privacy.update", consent)
	saved := call(t, s, a, "command.record", record).(map[string]any)
	event := saved["event"].(CommandEvent)
	if event.Command != "git status" || event.ExitCode != nil || event.DurationMS != nil || event.Status != "submitted" {
		t.Fatal("unsafe command result")
	}
	if call(t, s, a, "command.record", record).(map[string]any)["recorded"] != false {
		t.Fatal("event replay counted")
	}
	if len(call(t, s, b, "history.list", empty).(map[string]any)["items"].([]CommandEvent)) != 0 {
		t.Fatal("cross owner history")
	}
	reject(t, s, a, "history.list", map[string]any{"userId": first.SessionID}, "INVALID_REQUEST")
	usage := call(t, s, a, "usage.get", empty).(Usage)
	if usage.Commands != 1 || usage.TotalTokens != 0 {
		t.Fatal("unmeasured usage")
	}
	result := call(t, s, a, "recommendations.get", empty).(map[string]any)
	if result["mode"] != "catalog" {
		t.Fatal("catalog falsely reported model")
	}
	call(t, s, a, "recommendation.click", map[string]string{"id": "git-status"})
	call(t, s, a, "terminal.record", map[string]string{"eventId": uuid(), "state": "connected"})
	call(t, s, a, "terminal.record", map[string]string{"eventId": uuid(), "state": "disconnected"})
	call(t, s, a, "analytics.delete", empty)
	if call(t, s, a, "usage.get", empty).(Usage).RecommendationClicks != 0 {
		t.Fatal("analytics deletion failed")
	}
	email := uuid() + "@example.invalid"
	password := strings.Repeat("test-passphrase-", 60)
	account := call(t, s, a, "account.register", map[string]string{"email": email, "password": password, "name": strings.Repeat("n", 120)}).(Snapshot)
	if account.Identity != "authenticated" || account.SessionID == first.SessionID || account.User == nil {
		t.Fatal("account identity not rotated")
	}
	if len(call(t, s, a, "history.list", empty).(map[string]any)["items"].([]CommandEvent)) != 1 {
		t.Fatal("eligible guest history not linked")
	}
	logout := call(t, s, a, "account.logout", empty).(Snapshot)
	if logout.Identity != "guest" || logout.SessionID == account.SessionID {
		t.Fatal("logout did not rotate")
	}
	if len(call(t, s, a, "history.list", empty).(map[string]any)["items"].([]CommandEvent)) != 0 {
		t.Fatal("logout leaked account")
	}
	reject(t, s, a, "account.login", map[string]string{"email": email, "password": password + "wrong"}, "UNAUTHORIZED")
	call(t, s, a, "account.login", map[string]string{"email": email, "password": password})
	if len(call(t, s, a, "history.list", empty).(map[string]any)["items"].([]CommandEvent)) != 1 {
		t.Fatal("login failed to restore owner history")
	}
	export := call(t, s, a, "data.export", empty).(map[string]any)
	if len(export["history"].([]CommandEvent)) != 1 {
		t.Fatal("export missing history")
	}
	call(t, s, a, "history.delete", empty)
	if call(t, s, a, "usage.get", empty).(Usage).Commands != 0 {
		t.Fatal("history deletion failed")
	}
	reject(t, s, b, "admin.overview", empty, "FORBIDDEN")
	call(t, s, b, "guest.delete", empty)
}

func TestPostgresQuotaConcurrencyAndModelReconciliation(t *testing.T) {
	s := testService(t)
	p := identity()
	call(t, s, p, "session.current", map[string]any{})
	var owner string
	if err := s.db.QueryRow(`SELECT owner_id FROM terminus_intelligence.quota_principals WHERE credential_id=$1 AND device_id=$2`, p.CredentialID, p.DeviceID).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	ids := []string{uuid(), uuid()}
	results := make(chan bool, 2)
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			var ok bool
			err := s.db.QueryRow(`SELECT terminus_intelligence.reserve_tokens($1,$2,date_trunc('month',now() AT TIME ZONE 'UTC')::date,80000,now()+interval '30 seconds')`, owner, id).Scan(&ok)
			if err != nil {
				t.Error("reservation failed")
			}
			results <- ok
		}(id)
	}
	wg.Wait()
	close(results)
	n := 0
	for ok := range results {
		if ok {
			n++
		}
	}
	if n != 1 {
		t.Fatal("concurrent reservations exceeded quota")
	}
	for _, id := range ids {
		var ok bool
		if err := s.db.QueryRow(`SELECT terminus_intelligence.finalize_tokens($1,$2,0,0,false)`, owner, id).Scan(&ok); err != nil {
			t.Fatal(err)
		}
	}
	// Explicit model boundary double with actual PostgreSQL accounting. No live
	// model assertion is made by this deterministic response test.
	model := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if strings.Contains(fmt.Sprint(body), "private-query") {
			t.Error("private query crossed model boundary")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"response":"Review the working tree before making changes.","done":true,"prompt_eval_count":17,"eval_count":9}`)
	}))
	defer model.Close()
	var err error
	s.model, err = newLocalModel(model.URL, "synthetic-boundary-double")
	if err != nil {
		t.Fatal(err)
	}
	data := call(t, s, p, "recommendations.get", map[string]string{"query": "git"}).(map[string]any)
	if data["mode"] != "local-model" {
		t.Fatal("provider completion not reconciled")
	}
	usage := call(t, s, p, "usage.get", map[string]any{}).(Usage)
	if usage.InputTokens != 17 || usage.OutputTokens != 9 || usage.TotalTokens != 26 || usage.AIRequests != 1 {
		t.Fatal("actual provider counts not recorded")
	}
	call(t, s, p, "guest.delete", map[string]any{})
	if call(t, s, p, "usage.get", map[string]any{}).(Usage).RemainingTokens != usage.RemainingTokens {
		t.Fatal("guest reset replenished quota")
	}
	call(t, s, p, "account.logout", map[string]any{})
	if call(t, s, p, "usage.get", map[string]any{}).(Usage).RemainingTokens != usage.RemainingTokens {
		t.Fatal("logout replenished quota")
	}
}

func TestPostgresExpiryAndValidation(t *testing.T) {
	s := testService(t)
	p := identity()
	call(t, s, p, "privacy.update", consent)
	call(t, s, p, "command.record", map[string]string{"eventId": uuid(), "command": "git status"})
	_, err := s.db.Exec(`UPDATE terminus_intelligence.command_events SET created_at=now()-interval '31 days',expires_at=now()-interval '1 day' WHERE owner_id=(SELECT owner_id FROM terminus_intelligence.sessions WHERE credential_id=$1 AND device_id=$2)`, p.CredentialID, p.DeviceID)
	if err != nil {
		t.Fatal(err)
	}
	if len(call(t, s, p, "history.list", map[string]any{}).(map[string]any)["items"].([]CommandEvent)) != 0 {
		t.Fatal("expired history visible")
	}
	for _, params := range []map[string]any{{"limit": 101}, {"limit": 0}, {"limit": nil}, {"query": strings.Repeat("x", 257)}} {
		reject(t, s, p, "history.list", params, "INVALID_REQUEST")
	}
	reject(t, s, p, "privacy.update", map[string]bool{"history": false, "analytics": false, "personalization": true}, "INVALID_REQUEST")
	reject(t, s, p, "terminal.execute", map[string]any{}, "INVALID_REQUEST")
	s.maintain(context.Background())
}

func TestLocalModelDestinationValidation(t *testing.T) {
	for _, u := range []string{"http://localhost:11434", "https://127.0.0.1:11434", "http://127.0.0.1:11434/path", "http://user:pass@127.0.0.1:11434", "http://192.0.2.1:11434", "http://127.0.0.1:11434/?token=x"} {
		if _, err := newLocalModel(u, "model"); err == nil {
			t.Fatal("unsafe model destination")
		}
	}
}

func TestPostgresExportPaginationAndCursorIsolation(t *testing.T) {
	s := testService(t)
	p := identity()
	call(t, s, p, "privacy.update", consent)
	var owner string
	if err := s.db.QueryRow(`SELECT owner_id FROM terminus_intelligence.sessions WHERE credential_id=$1 AND device_id=$2`, p.CredentialID, p.DeviceID).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 61; i++ {
		if _, err := s.db.Exec(`INSERT INTO terminus_intelligence.command_events(owner_id,event_id,command,category,purpose) VALUES($1,$2,'git status','git','Show repository working tree status')`, owner, uuid()); err != nil {
			t.Fatal(err)
		}
	}
	first := call(t, s, p, "data.export", map[string]any{}).(map[string]any)
	items := first["history"].([]CommandEvent)
	cursor := first["nextCursor"].(*string)
	if len(items) != 50 || cursor == nil {
		t.Fatal("export first page not bounded")
	}
	second := call(t, s, p, "data.export", map[string]any{"cursor": *cursor}).(map[string]any)
	if len(second["history"].([]CommandEvent)) != 11 || second["nextCursor"].(*string) != nil {
		t.Fatal("export page omitted rows")
	}
	ids := map[string]bool{}
	for _, item := range items {
		ids[item.ID] = true
	}
	for _, item := range second["history"].([]CommandEvent) {
		if ids[item.ID] {
			t.Fatal("page duplicated row")
		}
	}
	if len(call(t, s, p, "history.list", map[string]any{}).(map[string]any)["items"].([]CommandEvent)) != 50 {
		t.Fatal("history default not50")
	}
	reject(t, s, identity(), "data.export", map[string]any{"cursor": *cursor}, "NOT_FOUND")
	call(t, s, p, "history.delete", map[string]any{})
	reject(t, s, p, "data.export", map[string]any{"cursor": *cursor}, "NOT_FOUND")
}

func TestPostgresCanonicalRPCFixtures(t *testing.T) {
	s := testService(t)
	p := identity()
	raw, err := os.ReadFile("../../../../packages/protocol/intelligence-rpc-fixtures-1.0.json")
	if err != nil {
		raw, err = exec.Command("git", "show", "7eab6ce:packages/protocol/intelligence-rpc-fixtures-1.0.json").Output()
	}
	if err != nil {
		t.Fatal("canonical RPC fixture unavailable")
	}
	type fixture struct {
		Name  string
		Frame struct {
			Method string
			Params json.RawMessage
		}
	}
	var corpus struct{ Accepted, Rejected []fixture }
	if json.Unmarshal(raw, &corpus) != nil {
		t.Fatal("invalid corpus")
	}
	for _, item := range corpus.Accepted {
		if _, code := s.Call(context.Background(), p, item.Frame.Method, item.Frame.Params); code != "" {
			t.Fatalf("canonical accepted %s rejected", item.Name)
		}
	}
	for _, item := range corpus.Rejected {
		// These two are transport envelope gates, checked by endpoint fixture tests.
		if item.Name == "unknown-envelope-field" || item.Name == "invalid-id" {
			continue
		}
		if _, code := s.Call(context.Background(), p, item.Frame.Method, item.Frame.Params); code != "INVALID_REQUEST" {
			t.Fatalf("canonical rejected %s accepted", item.Name)
		}
	}
}
