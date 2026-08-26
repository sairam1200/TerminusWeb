# Session 02 Status

- Current task: `S02-002` — Implement browser protocol client and private WSS behavior
- State: review-ready; deterministic Session 02 owner gate passed, while approved live private-WSS integration evidence remains unavailable. Authoritative queue transitions remain Session 01-owned.
- Branch: `session/02-web`
- Authoritative queue: Session 01 commit `7422df6d827e20bf8c770d1ea0d0762229121f12`.
- Protocol consumed: exact Session 01 product commit `910b69e24f464bb3e89152f3e5881beb9b706b76`, wire version `0.1`, subprotocol `terminus.v0_1`.

## Dependency verification

- `S01-001`: owner `session-01`; authoritative state `done`; exact product commit `910b69e24f464bb3e89152f3e5881beb9b706b76`. Its status records an independent PASS and the frozen schema, state machine, accepted/rejected fixtures, security contract, and HMAC vectors consumed here.
- `S02-001`: owner `session-02`; authoritative state `done`; exact product commit `055692f46ac61228f0592af96f06a99e55e431ce`; status handoff commit `0ded9446187327ade915401bfc053cf51dff829c`. Its status records independent reviewer PASS.
- `S02-002`: authoritative state `ready` at queue commit `7422df6d827e20bf8c770d1ea0d0762229121f12`; both dependencies were therefore satisfied before implementation began.
- Queue, shared contracts, governance, or other sessions' paths were not modified.

## Product implementation

- `apps/web/protocol/**`: strict protocol 0.1 types, duplicate-key-aware JSON codec, exact schema/payload validation, canonical fixture runner, transition machine, HMAC proof, credential storage, and endpoint/origin policy.
- `apps/web/terminal/protocolTerminalAdapter.ts`: exact `wss:` endpoint and HTTPS Origin enforcement, `terminus.v0_1` negotiation, independent sequence handling, pairing/authentication, open/input/output/resize, heartbeat/liveness, detach/resume, authorization expiry, clean close, and fail-closed error handling.
- Resume acceptance requires the exact unexpired in-memory detached grant and matching session ID. Outbound frames enforce `bufferedAmount + UTF-8 frame bytes <= 65,536`, otherwise `BACKPRESSURE_LIMIT`/1008. Paired credentials accept expiry only in `(now, now + 30 days]`.
- `apps/web/protocol/credentialStore.ts`: imports raw pairing material directly into a non-extractable HMAC `CryptoKey`; IndexedDB persists only that protected key plus non-secret identifiers/expiry. Resume grants remain memory-only. No local/session storage, cookie, service-worker cache, console logging, terminal plaintext logging, or secret logging was added.
- `apps/web/components/TerminalShell.tsx` and `app/page.tsx`: select the real protocol adapter only when both exact public endpoint/origin settings are supplied; otherwise preserve the visibly labelled socket-free simulation. Pairing input is transient and cleared before the await boundary. Background visibility detaches and foreground visibility resumes only from detached state.
- `apps/web/next.config.ts`: `connect-src` defaults to `'self'` and adds only the exact configured `wss://host[:port]` source after policy validation.
- Added failure coverage for malformed/binary/oversized/duplicate/unknown frames, replay/gap/direction/state errors, wrong subprotocol, insecure or credential-bearing destinations, query-bearing destinations, wrong/non-HTTPS origins, HMAC mutations, expired credentials, over-30-day credentials, resume mismatch/expiry, and outbound backpressure.
- Locked test-only dependency added: `fake-indexeddb@6.2.5`; final `npm ls --depth=0` passed with the existing locked application/test graph.

## Exact commands and deterministic evidence

- Required-source reads used `Get-Content` for `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/SHARED_CONTRACTS.md`, `docs/DEFINITION_OF_DONE.md`, `agents/session-02-web.md`, `coordination/ownership.yaml`, and this status file.
- Exact authoritative reads used `git show 7422df6d827e20bf8c770d1ea0d0762229121f12:coordination/tasks.yaml`, the dependency status files at that commit, and `git show`/`git ls-tree -r` against `910b69e24f464bb3e89152f3e5881beb9b706b76` for every protocol/schema/state/fixture/security/auth-vector artifact.
- `npm run format` => pass; all files formatted or unchanged.
- `npm run format:check` => pass; all matched files use Prettier style.
- `npm run lint` => pass; exit 0 with no reported warnings/errors.
- `npm run typecheck` => pass; `tsc --noEmit` exit 0.
- `npx vitest run --reporter=verbose` => pass after final repairs: 7 files, 32 tests. The canonical test reads fixtures directly from exact Git commit `910b69e...`; all 27 canonical handshake/transcript fixtures passed, as did the positive HMAC vector and all four negative mutations.
- `npm test` => sandboxed attempt failed only because Vite could not spawn its config child process (`spawn EPERM`); approved outside-sandbox rerun passed before repairs with 7 files/28 tests, and the final verbose run after repairs passed 7 files/32 tests.
- `npm run build` => pass after final repairs; Next.js 16.3.3 compiled, typechecked, and statically prerendered `/`, `/_not-found`, and `/manifest.webmanifest`.
- `$env:NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT='wss://agent.private.invalid/terminal'; $env:NEXT_PUBLIC_TERMINUS_WEB_ORIGIN='https://preview.example.invalid'; npm run build` => pass after final repairs with the protocol-client configuration and exact CSP source.
- `npm ls --depth=0` => pass; all direct dependencies resolved, including `fake-indexeddb@6.2.5`.
- `rg -n "console\\.|localStorage|sessionStorage|document\\.cookie|ws://|https?://|Authorization|Cookie|Sec-WebSocket-Protocol" app components protocol terminal next.config.ts securityHeaders.test.ts` => only expected tests/constants and authorization method names; no browser secret/plaintext logging or prohibited persistence path.
- `git diff --cached --check` before each product commit => pass with no output. Product and repair scopes contained only `apps/web/**`.

## Browser evidence

- `npx next start -H 127.0.0.1 -p 3212` => local production server ready at `http://127.0.0.1:3212`; no deployment.
- `npx --yes --package @playwright/cli playwright-cli -s=s02-002-browser open http://127.0.0.1:3212` => Chromium opened the built unconfigured application; title `Terminus`.
- `... resize 1440 900` then `... snapshot` => accessible desktop shell, visibly labelled `SIMULATED UI — NO TERMINAL CONNECTION`, disconnected state, disabled input, and computed viewport `134 × 23`.
- `... resize 390 844` then `... snapshot` => accessible portrait shell, `43 × 17` viewport, and seven disabled accessible mobile terminal-key controls while disconnected.
- `... console` => 0 errors and 0 warnings.
- This browser run intentionally verifies the unconfigured safe fallback and responsive regression only. It does not prove the configured WSS handshake.
- Attempting a configured local HTTPS browser run with Next's `--experimental-https` first failed in the sandbox on certificate-process permissions, then the approved retry reached a self-signed certificate trust prompt. It was terminated rather than mutating the host trust store; the empty generated `apps/web/certificates` directory was removed. This attempt is not counted as successful evidence.

## Independent review

- Reviewer: read-only agent `/root/s02_002_independent_review`.
- Initial verdict: FAIL for exact commit `690274fe63ac596e5b36e34a4dd49b553c3abd88`. Findings were missing resume-session identity/expiry enforcement, missing outbound buffer bound, and missing 30-day credential-expiry cap. The reviewer made no edits.
- Repairs were committed separately at `aec63af0ce7512341555910e59f3617543869c4a`, preserving the failed-review SHA for audit history. The exact cumulative product tip for integration/review is `aec63af0ce7512341555910e59f3617543869c4a`.
- Final verdict: PASS for exact cumulative product tip `aec63af0ce7512341555910e59f3617543869c4a` at the Session 02 code/deterministic owner gate.
- Reviewer independently reproduced `npm run format:check`, `npm run lint`, `npm run typecheck`, `npx vitest run --reporter=verbose` (7 files/32 tests), default `npm run build`, configured WSS/origin `npm run build`, cumulative and repair-only `git diff --check`, and clean exact-SHA worktree/scope checks.
- Reviewer confirmed the three repairs, exact `910b69e...` fixture/HMAC coverage, and Session 02-only cumulative scope.
- Reviewer limitation: no approved real private WSS integration environment exists. The PASS does not establish a real terminal path, browser Origin-header acceptance by an agent, end-to-end behavior, Session 06 `verified`, integration, deployment, or release.

## Evidence classification and limitations

- Deterministic real code: strict codec/state/crypto/endpoint/storage behavior, exact commit-backed fixtures, production builds, CSP generation, and failure paths.
- Test-double backed: WebSocket lifecycle, Origin/subprotocol expectations, pairing/auth/open/IO/resize/heartbeat/detach/resume/close, backpressure, and IndexedDB behavior use explicit mock WebSocket/fake IndexedDB boundaries.
- Real browser: only the unconfigured local responsive/safety fallback was exercised. No approved private agent, exact real WSS destination, or agent Origin allowlist was available, so no live connection or end-to-end claim is made.
- No physical iPhone Safari run, Session 06 independent verification, merge, push, deployment, DNS/Tailscale mutation, public exposure, or release occurred.

## Commits

- Initial product commit (failed first review, retained for audit): `690274fe63ac596e5b36e34a4dd49b553c3abd88`.
- Exact cumulative product/task tip after reviewed repairs: `aec63af0ce7512341555910e59f3617543869c4a`.
- Handoff commit: resolve from branch HEAD after the status-only handoff commit.
