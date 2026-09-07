package intelligence

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

func (s *Service) usage(ctx context.Context, tx *sql.Tx, owner, quotaOwner string) (Usage, error) {
	out := Usage{TokenLimit: 100000, RemainingTokens: 100000, TopCommands: []TopCommand{}}
	err := tx.QueryRowContext(ctx, `SELECT count(*) FROM terminus_intelligence.sessions WHERE owner_id=$1 AND expires_at>now()`, owner).Scan(&out.Sessions)
	if err != nil {
		return out, err
	}
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM terminus_intelligence.command_events WHERE owner_id=$1 AND expires_at>now()`, owner).Scan(&out.Commands)
	if err != nil {
		return out, err
	}
	err = tx.QueryRowContext(ctx, `SELECT coalesce(sum(duration_ms),0),count(*) FILTER(WHERE kind='recommendation.impression'),count(*) FILTER(WHERE kind='recommendation.click') FROM terminus_intelligence.analytics_events WHERE owner_id=$1 AND expires_at>now()`, owner).Scan(&out.TerminalTimeMS, &out.RecommendationImpressions, &out.RecommendationClicks)
	if err != nil {
		return out, err
	}
	var reserved int64
	err = tx.QueryRowContext(ctx, `SELECT input_tokens,output_tokens,reserved_tokens,token_limit FROM terminus_intelligence.quota_months WHERE owner_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`, quotaOwner).Scan(&out.InputTokens, &out.OutputTokens, &reserved, &out.TokenLimit)
	if err != nil && err != sql.ErrNoRows {
		return out, err
	}
	out.TotalTokens = out.InputTokens + out.OutputTokens
	out.RemainingTokens = out.TokenLimit - out.TotalTokens - reserved
	err = tx.QueryRowContext(ctx, `SELECT count(*) FROM terminus_intelligence.token_ledger WHERE owner_id=$1 AND month=date_trunc('month',now() AT TIME ZONE 'UTC')::date`, quotaOwner).Scan(&out.AIRequests)
	if err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT command,count(*) FROM terminus_intelligence.command_events WHERE owner_id=$1 AND expires_at>now() GROUP BY command ORDER BY count(*) DESC,command LIMIT 10`, owner)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item TopCommand
		if err := rows.Scan(&item.Command, &item.Count); err != nil {
			return out, err
		}
		out.TopCommands = append(out.TopCommands, item)
	}
	if !safeCounts(out.Sessions, out.Commands, out.TerminalTimeMS, out.RecommendationImpressions, out.RecommendationClicks, out.InputTokens, out.OutputTokens, out.TotalTokens, out.AIRequests, out.TokenLimit, out.RemainingTokens) {
		return out, errors.New("aggregate unavailable")
	}
	for _, item := range out.TopCommands {
		if !safeCounts(item.Count) {
			return out, errors.New("aggregate unavailable")
		}
	}
	return out, rows.Err()
}
func (s *Service) admin(ctx context.Context, tx *sql.Tx) (any, error) {
	var users, sessions, commands, input, output, active int64
	err := tx.QueryRowContext(ctx, `SELECT (SELECT count(*) FROM terminus_intelligence.accounts),(SELECT count(*) FROM terminus_intelligence.sessions WHERE expires_at>now()),(SELECT count(*) FROM terminus_intelligence.command_events WHERE expires_at>now()),coalesce(sum(input_tokens),0),coalesce(sum(output_tokens),0) FROM terminus_intelligence.token_ledger`).Scan(&users, &sessions, &commands, &input, &output)
	// Active connections is not guessed from stored activity; the endpoint adds
	// a live counter through SetActiveConnections when installed in the host.
	if s.activeConnections != nil {
		active = s.activeConnections()
	}
	if !safeCounts(users, sessions, commands, input, output, active) || input+output > 9007199254740991 {
		return nil, errors.New("aggregate unavailable")
	}
	return map[string]int64{"users": users, "sessions": sessions, "commands": commands, "inputTokens": input, "outputTokens": output, "totalTokens": input + output, "activeConnections": active}, err
}

func safeCounts(values ...int64) bool {
	for _, v := range values {
		if v < 0 || v > 9007199254740991 {
			return false
		}
	}
	return true
}
func (s *Service) SetActiveConnections(fn func() int64) { s.activeConnections = fn }

func (s *Service) maintenanceLoop() {
	defer close(s.done)
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			s.maintain(ctx)
			cancel()
		}
	}
}
func (s *Service) maintain(ctx context.Context) {
	// Work is bounded per tick; queries independently exclude expiry immediately.
	for _, table := range []string{"command_events", "analytics_events", "sessions"} {
		_, _ = s.db.ExecContext(ctx, "DELETE FROM terminus_intelligence."+table+" WHERE ctid IN (SELECT ctid FROM terminus_intelligence."+table+" WHERE expires_at<=now() LIMIT 100)")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT owner_id,request_id FROM terminus_intelligence.reservations WHERE status='reserved' AND expires_at<=now() LIMIT 100`)
	if err == nil {
		type reservation struct{ o, r string }
		var expired []reservation
		for rows.Next() {
			var r reservation
			if rows.Scan(&r.o, &r.r) == nil {
				expired = append(expired, r)
			}
		}
		rows.Close()
		for _, r := range expired {
			_, _ = s.db.ExecContext(ctx, `SELECT terminus_intelligence.finalize_tokens($1,$2,0,0,false)`, r.o, r.r)
		}
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return
	}
	defer tx.Rollback()
	rows, err = tx.QueryContext(ctx, `SELECT id FROM terminus_intelligence.owners WHERE account_id IS NULL AND NOT EXISTS(SELECT 1 FROM terminus_intelligence.quota_principals WHERE owner_id=owners.id) AND last_seen_at<=now()-interval '7 days' AND (history OR analytics OR personalization OR EXISTS(SELECT 1 FROM terminus_intelligence.sessions WHERE owner_id=owners.id)) LIMIT 100 FOR UPDATE SKIP LOCKED`)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) != nil {
			rows.Close()
			return
		}
		ids = append(ids, id)
	}
	rows.Close()
	for _, id := range ids {
		for _, table := range []string{"command_events", "analytics_events", "sessions"} {
			if _, err = tx.ExecContext(ctx, "DELETE FROM terminus_intelligence."+table+" WHERE owner_id=$1", id); err != nil {
				return
			}
		}
		if _, err = tx.ExecContext(ctx, `UPDATE terminus_intelligence.owners SET history=false,analytics=false,personalization=false WHERE id=$1`, id); err != nil {
			return
		}
	}
	_ = tx.Commit()
	s.mu.Lock()
	for id, a := range s.attempts {
		if time.Since(a.since) > 5*time.Minute {
			delete(s.attempts, id)
		}
	}
	for id, start := range s.connected {
		if time.Since(start) > 45*time.Second {
			delete(s.connected, id)
		}
	}
	s.mu.Unlock()
}
