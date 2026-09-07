\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_true(actual boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF actual IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion failed: %', label; END IF;
END;
$$;
CREATE FUNCTION pg_temp.reject(sql text, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN check_violation OR foreign_key_violation OR unique_violation OR insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'expected rejection: %', label;
END;
$$;
SELECT pg_temp.assert_true(to_regclass('terminus_cp.accounts') IS NOT NULL, 'metadata schema preserved');
SET LOCAL ROLE terminus_intelligence_app;
INSERT INTO terminus_intelligence.accounts(id,email,password_hash,name)
  VALUES ('99999999-9999-4999-8999-999999999999',repeat('a',320),repeat('x',32),repeat('n',120));
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.accounts SET name=repeat('n',121)$s$, 'name maximum120');
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.accounts SET email=repeat('a',321)$s$, 'email maximum320');
INSERT INTO terminus_intelligence.owners(id) VALUES
  ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
INSERT INTO terminus_intelligence.quota_principals(credential_id,device_id,owner_id)
  VALUES ('synthetic','synthetic','11111111-1111-4111-8111-111111111111');
SELECT pg_temp.reject('DELETE FROM terminus_intelligence.quota_principals', 'quota identity deletion denied');
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.quota_principals SET owner_id='22222222-2222-4222-8222-222222222222'$s$, 'quota identity reset denied');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.quota_principals(credential_id,device_id,owner_id) VALUES ('synthetic','synthetic','22222222-2222-4222-8222-222222222222')$s$, 'duplicate credential quota identity denied');
SELECT pg_temp.assert_true((SELECT NOT history AND NOT analytics AND NOT personalization FROM terminus_intelligence.owners LIMIT 1), 'consent defaults off');
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.owners SET personalization = true$s$, 'personalization requires history');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.command_events(owner_id,event_id,command,category,purpose) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[redacted command]','unknown','Redacted')$s$, 'history denied without consent');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.analytics_events(owner_id,event_id,kind) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','terminal.connected')$s$, 'analytics denied without consent');
UPDATE terminus_intelligence.owners SET history = true, analytics = true WHERE id = '11111111-1111-4111-8111-111111111111';
INSERT INTO terminus_intelligence.command_events(owner_id,event_id,command,category,purpose) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','[redacted command]','unknown','Redacted');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.command_events SELECT * FROM terminus_intelligence.command_events$s$, 'idempotency unique per owner');
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.command_events SET owner_id = '22222222-2222-4222-8222-222222222222'$s$, 'link cannot bypass destination consent');
SELECT pg_temp.assert_true((SELECT count(*) = 0 FROM terminus_intelligence.command_events WHERE owner_id = '22222222-2222-4222-8222-222222222222'), 'owner scoped query');
SELECT pg_temp.reject($s$UPDATE terminus_intelligence.command_events SET expires_at = created_at + interval '31 days'$s$, 'retention max30d');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.analytics_events(owner_id,event_id,kind,duration_ms) VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','terminal.disconnected',45001)$s$, 'duration bounded');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.sessions(id,credential_id,device_id,owner_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic','synthetic','33333333-3333-4333-8333-333333333333')$s$, 'session owner FK');
INSERT INTO terminus_intelligence.sessions(id,credential_id,device_id,owner_id) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','synthetic','synthetic','11111111-1111-4111-8111-111111111111');
SELECT pg_temp.reject($s$INSERT INTO terminus_intelligence.sessions(id,credential_id,device_id,owner_id) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','synthetic','synthetic','22222222-2222-4222-8222-222222222222')$s$, 'single active credential/device association');
UPDATE terminus_intelligence.sessions SET id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',owner_id = '22222222-2222-4222-8222-222222222222';
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM terminus_intelligence.command_events WHERE owner_id = '11111111-1111-4111-8111-111111111111'), 'logout rotation preserves prior owner history');
SELECT pg_temp.assert_true((SELECT owner_id='11111111-1111-4111-8111-111111111111'::uuid FROM terminus_intelligence.quota_principals WHERE credential_id='synthetic' AND device_id='synthetic'), 'logout does not rotate accounting identity');
SELECT pg_temp.assert_true(terminus_intelligence.reserve_tokens('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',date_trunc('month',now() AT TIME ZONE 'UTC')::date,80000,now()+interval '30 seconds'), 'reservation accepted');
SELECT pg_temp.assert_true(NOT terminus_intelligence.reserve_tokens('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc',date_trunc('month',now() AT TIME ZONE 'UTC')::date,100,now()+interval '30 seconds'), 'unbound history owner cannot create quota');
SELECT pg_temp.assert_true(NOT terminus_intelligence.reserve_tokens('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',date_trunc('month',now() AT TIME ZONE 'UTC')::date,80000,now()+interval '30 seconds'), 'quota fenced');
SELECT pg_temp.assert_true(NOT terminus_intelligence.finalize_tokens('22222222-2222-4222-8222-222222222222','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',100,20,true), 'cross owner finalize rejected');
SELECT pg_temp.assert_true(NOT terminus_intelligence.finalize_tokens('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',80001,0,true), 'over reservation rejected');
SELECT pg_temp.assert_true(terminus_intelligence.finalize_tokens('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',100,20,true), 'actual counts reconciled');
SELECT pg_temp.assert_true(NOT terminus_intelligence.finalize_tokens('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',100,20,true), 'duplicate ledger prevented');
SELECT pg_temp.assert_true((SELECT reserved_tokens = 0 AND input_tokens = 100 AND output_tokens = 20 FROM terminus_intelligence.quota_months WHERE owner_id = '11111111-1111-4111-8111-111111111111'), 'actual quota totals');
SELECT pg_temp.reject('UPDATE terminus_intelligence.token_ledger SET input_tokens=0', 'app ledger update denied');
SELECT pg_temp.reject('DELETE FROM terminus_intelligence.token_ledger', 'app ledger deletion denied');
SELECT pg_temp.reject('UPDATE terminus_intelligence.quota_months SET token_limit=9007199254740991', 'app quota mutation denied');
SELECT pg_temp.reject('SELECT * FROM terminus_cp.accounts', 'private app has no control plane access');
SELECT pg_temp.assert_true(terminus_intelligence.reserve_tokens('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',date_trunc('month',now() AT TIME ZONE 'UTC')::date,100,now()+interval '30 seconds'), 'second reservation');
SELECT pg_temp.assert_true(terminus_intelligence.finalize_tokens('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',0,0,false), 'failed generation releases');
SELECT pg_temp.assert_true((SELECT count(*) = 1 FROM terminus_intelligence.token_ledger), 'failed generation no synthetic usage');
DELETE FROM terminus_intelligence.sessions;
DELETE FROM terminus_intelligence.command_events;
DELETE FROM terminus_intelligence.analytics_events;
SELECT pg_temp.assert_true((SELECT q.input_tokens=100 AND q.output_tokens=20 FROM terminus_intelligence.quota_principals p JOIN terminus_intelligence.quota_months q ON q.owner_id=p.owner_id WHERE p.credential_id='synthetic' AND p.device_id='synthetic'), 'guest data deletion preserves paired quota');
RESET ROLE;
SELECT pg_temp.reject('DELETE FROM terminus_intelligence.token_ledger', 'ledger trigger also rejects administrator delete');
ROLLBACK;
\echo S04-003 private intelligence invariants PASS
