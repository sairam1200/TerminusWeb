-- Run explicitly as migration administrator. Creates no password or login.
-- Deployment administrator provisions a private LOGIN role separately and grants
-- membership in this capability role. Never give the agent migration ownership.
CREATE ROLE terminus_intelligence_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT USAGE ON SCHEMA terminus_intelligence TO terminus_intelligence_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  terminus_intelligence.accounts, terminus_intelligence.owners,
  terminus_intelligence.sessions, terminus_intelligence.command_events,
  terminus_intelligence.analytics_events TO terminus_intelligence_app;
GRANT SELECT ON terminus_intelligence.quota_months, terminus_intelligence.reservations,
  terminus_intelligence.token_ledger TO terminus_intelligence_app;
GRANT SELECT, INSERT ON terminus_intelligence.quota_principals TO terminus_intelligence_app;
GRANT EXECUTE ON FUNCTION terminus_intelligence.require_consent() TO terminus_intelligence_app;
GRANT EXECUTE ON FUNCTION terminus_intelligence.reserve_tokens(uuid, uuid, date, bigint, timestamptz),
  terminus_intelligence.finalize_tokens(uuid, uuid, bigint, bigint, boolean) TO terminus_intelligence_app;
