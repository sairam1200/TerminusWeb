# S06-009 independent private intelligence verification

Verifier: `/root/intelligence_verification`, Session 06. Date: 2026-09-07.
This report covers immutable component checks. Chrome staging and deployment
are separate evidence owned by coordinating Session 01; they are not inferred
from these checks.

## Exact inputs and isolation

| Component                             | Cumulative product                         |
| ------------------------------------- | ------------------------------------------ |
| Shared intelligence contract          | `3efefd6d83033743857ce6d4b88bd41b9bd55cfc` |
| PostgreSQL migration and grants       | `33cc6383ff6af9a049113206a6a57d8690936de2` |
| Windows host and intelligence service | `a6adf52afeeb87ad9e6907c79baa9c9023c562a4` |
| Web                                   | `cd6a1ef32e40f41ebada2b5a36cdcbefb90346ea` |

Read the required repository documents, Session 06 brief and skill, current
Session 01 queue, contract/addenda, producer handoffs and exact artifacts.
Source snapshots were made with `git archive` under ignored
`tmp/s06verify` in the exclusive Session 06 worktree. No products were merged,
cherry-picked, edited or repaired. Installed locked web dependencies were copied
from the producer installation; no environment files or secrets were copied.

Environment: Microsoft Windows NT 10.0.26200.0; Go 1.26.7 windows/amd64;
Node v24.15.0; installed Next 16.3.3 and Vitest 4.1.11.

## Independently reproduced checks

| Command and scope                                                                                                                             | Outcome                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `node packages/protocol/scripts/verify-intelligence.mjs` in contract snapshot                                                                 | Exit 0: canonical HMAC plus five domain/key/challenge binding mutations                              |
| Compare parsed shared auth/RPC JSON with web vendored corpora                                                                                 | Both structurally identical                                                                          |
| `go test -count=1 -json ./...` in exact agent snapshot with `TERMINUS_INTELLIGENCE_TEST_DATABASE_URL` pointing to disposable local PostgreSQL | Exit 0; five packages; 129 passing test/subtest events; two expected skips described below           |
| `go vet ./...`                                                                                                                                | Exit 0                                                                                               |
| `powershell -NoProfile -ExecutionPolicy Bypass -File infrastructure/database/run-intelligence-tests.ps1`                                      | Exit 0: migration/invariants, two-connection quota race, isolated rollback preserves metadata schema |
| `powershell -NoProfile -ExecutionPolicy Bypass -File infrastructure/database/run-isolated-tests.ps1`                                          | Exit 0: original metadata/RLS and concurrent final-owner invariants                                  |
| `npm test` in final web snapshot with public endpoint variables unset                                                                         | Exit 0: 14 files, 113 tests, no skips                                                                |
| `npm run lint`                                                                                                                                | Exit 0                                                                                               |
| `npm run typecheck`                                                                                                                           | Exit 0                                                                                               |
| `npm run build` with process-scoped public production endpoint/Origin                                                                         | Exit 0: nine static routes including account/privacy, history, usage, billing and admin              |
| `git diff f3e5bd6 <product> --check` for Go, SQL and web products                                                                             | Exit 0 for all three                                                                                 |

The two Go skips are `TestUnsupportedPlatformFailsClosed` (Windows exercises
the real adapter) and `TestConPTYAgentFailureHelper` (only runs when launched
as the integration test's child). No database tests were skipped. Real Windows
ConPTY suites and lifecycle/cleanup tests passed.

SQL harnesses create distinct disposable pinned PostgreSQL 17 containers and
remove only their own containers. They publish no host ports. Go database tests
used the coordinator's synthetic local database and non-owner capability role.
They did not access or migrate a production database. No live state or Chrome
operation was performed by this verifier.

The independent production build used
`NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT=wss://sai.tailf8dcea.ts.net/terminal` and
`NEXT_PUBLIC_TERMINUS_WEB_ORIGIN=https://terminus-web.vercel.app`. Generated CSP
contains exactly `connect-src 'self' wss://sai.tailf8dcea.ts.net`.
The generated routes-manifest SHA-256 is
`0C291EC302410C51F1B7C4218876034E3DF965AF01B2944A78EE1107131C30B5`.

## Evidence boundaries and negative coverage

The Go intelligence endpoint suite uses real TLS WebSockets, synthetic pairing
credentials and a test device resolver. Its RPC service is an explicit double.
It proves wrong Origin/device/proof/domain, unbound/expired credentials, stale
challenge, replay, unknown fields, binary/oversized frames, revocation and
terminal-auth admission behavior. It does not prove production client
certificate resolution or a combined browser-to-database path.

Separate Go service tests use actual PostgreSQL. They prove default-off consent,
sanitized persistence, owner isolation, idempotence, registration/login/logout,
long UTF-8 password handling, expiry, deletion, cursor-paged complete export,
foreign cursor rejection, stable paired-device quota and concurrent accounting.
Both Go consumers exercise the shared auth/RPC fixtures. The web exercises the
same corpora and validates retries, disposal, identity-sensitive export and
explicit composer behavior through JSDOM/WebSocket boundary doubles.

Local model reconciliation tests use a labelled HTTP provider double and actual
PostgreSQL reservations/ledger. Source inspection confirms explicit loopback IP,
redirect refusal, no environment proxy, catalog-only prompt and catalog-authoritative
commands/URLs. This proves deterministic retrieval/fallback and accounting, not
an actual installed Ollama generation or a hosted RAG service. No terminal data
is forwarded through Vercel by these paths.

## Failed attempts retained

- Initial sandbox Go cache and Docker pipe accesses were denied. Unchanged
  approved escalated reruns passed; these were environment access failures.
- An initial snapshot build using a dependency junction failed because Turbopack
  rejects a node_modules link outside its filesystem root. The verification setup
  was corrected by copying installed dependencies into the snapshot.
- The first final-web test invocation set production public configuration before
  unit tests. The pre-existing security-header test explicitly assumes no endpoint
  configuration, so it failed while 112 other tests passed. Clearing those variables
  for unit tests yielded 113/113. Production variables are set only for the build.
- An earlier `npm test -- --reporter=json --outputFile=...` invocation was parsed
  by npm as configuration rather than Vitest flags. Its ordinary test run passed
  112/112 against superseded `24e1821`; no JSON report is claimed from that command.

## Assessment

The reproduced component and shared-fixture gates pass with no unresolved finding
from this independent review. Full release status requires the separately recorded
Chrome desktop/mobile direct web-to-host-to-database result and exact integrated
candidate verification. No production deployment, live Ollama, physical iPhone,
Safari, Tailscale policy or production terminal connectivity claim is made here.

Coordinating Session 01 reported that Chrome private-staging navigation timed
out, followed by a CDP tab-focus timeout; the tab stayed at about:blank and the
host recorded TLS handshake EOF. This is reported coordinator evidence, not an
independently observed browser result. A client-certificate selection dialog is
only a hypothesis because native inspection was unavailable. Therefore the
authenticated Chrome gate is **blocked**, not passed, and S06-009 is not a
completed end-to-end or production release verification.
