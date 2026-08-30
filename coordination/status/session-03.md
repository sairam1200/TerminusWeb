# Session 03 Status

- Current task: S03-002 — Implement private HTTPS/WSS protocol 0.1 endpoint
- State: done (owner Definition of Done and exact-tip independent review PASS; awaiting Session 01 queue transition)
- Branch: `session/03-windows-agent`
- Authoritative inputs:
  - Session 01 queue ref `a9ffbab08f843c46b2321a34b4fdd4d6cc872f31` records S01-001 `done`, S03-001 `done`, and S03-002 `ready` with dependencies `[S01-001, S03-001]`.
  - Exact protocol/security cumulative product tip: `910b69e24f464bb3e89152f3e5881beb9b706b76`.
  - Exact completed S03-001 product tip: `637f1e99970ee543f3028a9e899bc8001a16a8e1`.
- Files changed:
  - `apps/windows-agent/README.md`
  - `apps/windows-agent/go.mod`
  - `apps/windows-agent/go.sum`
  - `apps/windows-agent/internal/protocol/protocol.go`
  - `apps/windows-agent/internal/protocol/machine.go`
  - `apps/windows-agent/internal/protocol/fixtures_test.go`
  - `apps/windows-agent/internal/endpoint/endpoint.go`
  - `apps/windows-agent/internal/endpoint/security.go`
  - `apps/windows-agent/internal/endpoint/server.go`
  - `apps/windows-agent/internal/endpoint/session.go`
  - `apps/windows-agent/internal/endpoint/endpoint_test.go`
  - `apps/windows-agent/internal/endpoint/endpoint_windows_test.go`
- Product evidence:
  - Implements exact `terminus.v0_1` HTTPS/WSS framing, strict required-member/duplicate/unknown/type/version validation, canonical base64url/timestamps/UUIDs, decoded and wire limits, independent direction sequences, replay/gap rejection, state transitions, and clean sequence exhaustion.
  - Enforces one exact configured HTTPS Origin, exact subprotocol, TLS-only requests, no credential-bearing query/cookie/authorization metadata, required private-device identity, and a caller-owned listener explicitly bound to loopback. `ServeTLS` rejects wildcard, LAN, unspecified, and tailnet-interface binds and requires TLS 1.3. Private publication remains an external approved Tailscale serving layer.
  - Enforces single-use 120-second pairing, mandatory bounded local approval, protected-store injection, credential expiry, canonical connection-bound HMAC-SHA-256 challenge authentication, proactive authorization expiry, synchronized revocation, atomic concurrent rate limits, unique connection IDs, and generic failure responses.
  - Enforces 15-second heartbeat/45-second valid-inbound liveness only after authentication, one terminal, bounded output/backpressure, cross-connection reauthenticated detach/resume, one-time credential/session-bound grants, ordered pending output, expiry, transition-delivery rollback cleanup, client-loss cleanup, and agent-shutdown admission sealing/error propagation.
  - Logs expose only the structured event code and non-secret connection ID. Terminal bytes, commands, synthetic PIDs, pairing material, credentials, proofs, challenges, grants, tokens, and reusable hashes are absent.
  - Gorilla WebSocket is pinned to v1.5.3. Installed module source/API was inspected for `Upgrader`, `SetReadLimit`, `ReadMessage`, `WriteMessage`, `WriteControl`, and its one-reader/one-writer contract. No vulnerable pre-v1.5.3 release is used.
- Commands/evidence:
  - Required governance/docs/session/ownership/queue/dependency/status reads and the all-ref committed request scan were completed before changes; no request addressed to Session 03 required a response.
  - Exact contract verifier from `910b69e24f464bb3e89152f3e5881beb9b706b76`: `protocol 0.1 verified: schema semantics, 22 transcripts, 27 fixtures, 1 positive auth vector(s), 4 negative auth mutations`.
  - `go test -count=1 -run Canonical ./internal/protocol ./internal/endpoint`: PASS against fixtures read by exact Git object SHA; canonical authentication proof PASS.
  - `go fmt ./...`: PASS.
  - `go vet ./...`: PASS.
  - `go test -short -count=1 ./...`: PASS.
  - `go test -count=1 ./...`: PASS, including real Windows endpoint and terminal integration suites.
  - `go test -short -count=20 ./internal/endpoint`: PASS in 23.709s.
  - Targeted protocol/security tests PASS for exact/missing/insecure origins, wrong subprotocol, unsupported negotiation, expired challenge/authorization, wrong proof, pairing consumption, concurrent rate reservations/cooldown, duplicate connection IDs, sequence replay/gap/exhaustion, WSS oversize close 1009, one-session admission, detach/resume/replayed grant, revocation and its blocking-store race, bounded cleanup/error propagation, positive/negative listener scope, and log redaction.
  - Real `TestRealConPTYThroughWSSCleanupPaths`: PASS on non-elevated Windows NT `10.0.26200.0` as `sai\saira`; proves WSS input/output/resize and captures only synthetic PowerShell/`ping.exe -t` PIDs, then verifies both shell and descendant exit after attached client loss and endpoint shutdown.
  - Real `go test -count=1 -v ./internal/terminal`: PASS for ConPTY input/output/resize/exit plus process-tree containment after natural exit, cancellation, timeout, explicit close, simulated agent failure, and concurrent close/wait.
  - Go test/log JSON scan: PASS; no terminal markers, synthetic PIDs, or reusable secret field names appeared.
  - `git diff --check`, `git show --check`, changed-path ownership review, and listener/log/secret scans: PASS.
  - Official Go 1.25.12 Windows AMD64 ZIP was used only from a temporary directory after SHA-256 verification `d5dc82da351b00e5eedd04f41356817d674cc4308131f0f638a5b14c5c3af4cb`; pinned modules used task-local temporary caches. Nothing was installed.
  - `CGO_ENABLED=1 go test -race ./internal/endpoint` was unavailable because no `gcc` exists in PATH. No compiler was installed. The repeated endpoint suite, synchronized regression tests, real concurrent lifecycle test, and independent review are the applicable concurrency evidence.
- Independent reviewer/evidence:
  - Read-only reviewer `/root/s03_002_readonly_review` reviewed the exact ancestry `2e6f205 -> eeaaf1d -> d993c3b -> 6e5ff87` against exact dependencies `910b69e...` and `637f1e9...`; no files or commits were created by the reviewer.
  - Earlier exact-tip reviews correctly failed schema, authorization-deadline, cross-connection resume, rate-limit, pairing timing, write-bound, output-order, transition-cleanup, revocation, connection-ID, session-reservation, cleanup-error, sequence-exhaustion, real-containment, and shutdown-admission gaps. Each finding was reproduced and fixed in later product-tip ancestry.
  - Final verdict on exact product tip `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`: PASS with no remaining severity findings.
  - Reviewer confirmed atomic permanent session-admission shutdown, all prior finding closures, exact dependency ancestry, `gofmt -d internal` with no diff, `git diff --check`, `git show --check`, owned paths only, clean worktree, and no installation, exposure, deployment, or mutation.
- Assumptions/limitations:
  - The endpoint is an internal library, not an installed/running service. A future consumer must inject a Windows protected-secret credential store appropriate to its service identity, a private-device resolver, local approval UI, TLS certificate, and an approved loopback listener.
  - No Tailscale policy, Serve/Funnel setting, DNS, LAN/public listener, service installation, deployment, or live endpoint was created or changed.
  - This owner/reviewer `done` evidence is not Session 06 `verified` evidence. Session 01 alone owns queue transitions and integration manifests.
- Blockers/next task:
  - No S03-002 implementation blocker remains. Session 01 must read this committed handoff from `session/03-windows-agent` and transition the authoritative queue.
  - Do not begin any later Session 03 task until Session 01 marks it ready.
- Product/task commit: `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc` (cumulative S03-002 product tip; includes `2e6f205477b0179ada04de692dccf52458b5692e`, `eeaaf1d7148ff8c1104af6a645108ee498795a69`, and `d993c3b00e2ad4511d4f83918e230919d6db630a`)
- Handoff commit: resolve from branch HEAD after this status-only handoff commit

## S03-003 handoff (2026-08-26)

- Current task: `S03-003` — Build runnable non-elevated integration host around private WSS library.
- Product state: implementation complete; real endpoint remains externally blocked because no already-trusted certificate/private publication mapping is available.
- Exact dependency: S03-002 product `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`; its exact handoff is `715aac71205f3c97b23d825b75c8d2fddf806b8a`. Session 01 queue assignment is from `bfb431a7694152e8d5caf124f58076d78443bd32`.
- Product files: `apps/windows-agent/cmd/integration-host/main_windows.go`, `main_unsupported.go`, `main_windows_test.go`, `store_windows.go`, `store_windows_test.go`, and `apps/windows-agent/README.md`.
- Implementation: Windows DPAPI `CurrentUser` protects the complete credential map for the non-elevated integration identity; store writes are encrypted and atomically replaced, with reset/delete controls. The host requires externally supplied certificate/key, validates hostname, server-auth usage, and current Windows trusted roots, enforces TLS 1.3, and delegates exact Origin/subprotocol/handshake/session rules to S03-002. It accepts only an explicit loopback listener, derives a local device identity only from a loopback peer, uses bounded mandatory operator approval, exposes a non-secret `/healthz`, and supports safe `serve`, `reset`, and `revoke` modes. No self-signed fallback, trust bypass, LAN/public bind, service, deployment, Tailscale change, or Funnel was added.
- Commands/evidence on non-elevated Windows NT `10.0.26200.0` as `sai\\saira`:
  - Exact contract verifier from dependency `910b69e24f464bb3e89152f3e5881beb9b706b76` extracted by Git object and `npm run verify`: PASS (`22 transcripts`, `27 fixtures`, `1 positive`, `4 negative`).
  - `go fmt ./...`: PASS.
  - `go vet ./...`: PASS.
  - `go test -short -count=1 ./...`: PASS.
  - `go test -count=1 ./cmd/integration-host ./internal/protocol ./internal/endpoint ./internal/terminal`: PASS.
  - `go test -short -count=20 ./cmd/integration-host ./internal/endpoint`: PASS (`24.185s`).
  - `CGO_ENABLED=1 go test -race ...`: unavailable; `gcc` is not installed. No compiler was installed. Repeated synchronized concurrency tests passed.
  - Host build without external certificate exits non-zero (`integration host unavailable`); no listener is started. The only current-user server-auth certificate candidate is `CN=localhost`, self-signed, and fails trusted-chain verification; it was not used.
  - Read-only listener check observed `non_loopback_listeners=0`; read-only Tailscale CLI status was unavailable. No private mapping was created or changed.
  - DPAPI round-trip test confirms encrypted-at-rest bytes, retrieval, delete, and reset. Resolver test rejects non-loopback peers. Certificate test rejects untrusted self-signed input. Endpoint/protocol/terminal suites retain positive/negative lifecycle, listener, origin, replay, oversize, cleanup, and redaction coverage.
- External blocker: an operator must supply an existing browser/OS-trusted certificate and hostname plus an independently approved Tailscale-private publication mapping and exact browser Origin. Session 03 must not install certificates, generate trust roots, publish, modify Tailscale policy, or expose a listener to satisfy this handoff. Therefore `coordination/requests/from-03-to-02-s02-002-real-wss-endpoint-ready.response.md` was not created.
- Independent reviewer: `/root/s03_002_readonly_review` was requested to inspect exact product `6f428f1b4df618d4fd9e18569d80b5bdb564a8b`; review result must be recorded before queue completion.
- Product/task commit: `6f428f1b4df618d4fd9e18569d80b5bdb564a8b9`.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S03-005 handoff (2026-08-27)

- Current task: `S03-005` — Support eight bounded independent ConPTY sessions.
- State: implementation and owner validation complete; independent review and Session 01 queue transition remain pending.
- Architecture input: Session 01 product `2e309afc90a9c657aa71864252882ae9eb9047c0` clarifies that each authenticated WebSocket owns one terminal and the agent-wide active/detached limit is eight. This is a compatible protocol 0.1 clarification; no schema, message, error enum, or version changed.
- Product files: `apps/windows-agent/internal/endpoint/session.go`, `endpoint_test.go`, `endpoint_windows_test.go`, and `apps/windows-agent/README.md`.
- Implementation: replaces the process-global singleton with a mutex-protected session map keyed by session ID. Admission is atomic at eight; a ninth request returns existing `SESSION_OPEN_FAILED` before `terminal.Adapter.Open` can create ConPTY. Input, resize, detach/resume, expiry, disconnect, credential revocation, shutdown, and cleanup operate on the correct owned session. Active and detached sessions count until terminal cleanup finishes, and a clean close releases the slot.
- Test evidence on non-elevated Windows:
  - Focused `go test -short -count=1 ./internal/endpoint`: PASS.
  - `go vet ./...`: PASS.
  - `go test -short -count=1 ./...`: PASS.
  - `go test -count=1 ./...`: PASS, including Windows ConPTY/process cleanup (`cmd/integration-host` 2.260s, `internal/endpoint` 7.147s, `internal/protocol` 2.077s, `internal/terminal` 14.309s).
  - `go test -count=20 ./internal/endpoint`: PASS in 112.343s.
  - New endpoint test opens eight authenticated connections, proves isolated input and resize on two sessions, rejects the ninth without creating a terminal, closes one, and admits a replacement. A concurrent registry test proves the boundary admits exactly eight of twelve simultaneous attempts.
  - Changed Go files pass `gofmt -l` with no output. The repository-wide `gofmt -l .` still reports unrelated pre-existing CRLF-formatted files; no unrelated formatting rewrite was made.
  - `git diff --check` and product `git show --check`: PASS.
  - Race mode remains unavailable because no `gcc` is installed; no compiler was installed. The required repeated endpoint concurrency suite passed.
- Security/operations: pairing, credential authentication, exact Origin validation, TLS/mTLS, authorization expiry, private loopback/Tailscale boundary, and Funnel-disabled policy are unchanged. No agent was started or stopped, no live endpoint or Tailscale policy changed, and no terminal plaintext or pairing material was logged.
- Independent reviewer: pending; do not mark this task `done` or `verified` until maker-independent review is recorded.
- Product/task commit: `f8dc2a8f10bee25ddcef6397b7ac44dfdc15f564`.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S03-005 revocation-race hardening (2026-08-27)

- Cumulative product tip: `0d489e71f6c19578c942dacd2ffcb4407dafe0ab` (includes initial S03-005 product `f8dc2a8f10bee25ddcef6397b7ac44dfdc15f564`).
- Follow-up: session admission now rejects a connection whose shutdown has begun, closing the ordering gap between credential revocation/disconnect and concurrent `open_session`. Multi-session revocation coverage proves that every active session sharing the revoked credential is closed and every authorization receives the generic authentication failure.
- Revalidation: focused endpoint PASS; `go vet ./...` PASS; full `go test -count=1 ./...` PASS (`cmd/integration-host` 2.812s, `internal/endpoint` 7.170s, `internal/protocol` 0.599s, `internal/terminal` 13.287s); `go test -count=20 ./internal/endpoint` PASS in 112.414s; `git diff --check` and product `git show --check` PASS.
- Independent review and integration remain pending. No live agent/network/deployment state changed.

## S03-005 no-fixed-cap follow-up (2026-08-29)

- State: `done` at the owner/reviewer level; this is not Session 06 `verified` evidence.
- Exact architecture/security input: Session 01 product `e795c391cbdb7a77c136ce5e15e0577331d436b7`, consumed with `git show` without merge or cherry-pick. Protocol 0.1 still permits one terminal per authenticated connection while imposing no fixed aggregate application session count.
- Exact product: `e13c4c8d2659125476c7458b45720892ee49fc24`.
- Product files: `apps/windows-agent/internal/endpoint/session.go`, `apps/windows-agent/internal/endpoint/endpoint_test.go`, and `apps/windows-agent/README.md`.
- Implementation: removed the legacy count predicate while retaining shutdown and closed-connection rejection, genuine adapter/ConPTY open failure reporting, independent active/detached accounting, cleanup, credential revocation, output bounds/backpressure, pairing/authentication, and private listener/security boundaries.
- Evidence on non-elevated Microsoft Windows NT `10.0.26200.0` as `sai\\saira`:
  - Focused positive/negative endpoint tests: PASS, including 12 authenticated endpoint sessions, 24 concurrent registry opens, genuine adapter-open failure, closed-connection rejection, and permanent shutdown rejection.
  - `go vet ./...`: PASS (`go-vet-exit=0`).
  - `go test -count=1 ./...`: PASS, including real Windows ConPTY/process cleanup (`cmd/integration-host` 1.655s, `internal/endpoint` 7.166s, `internal/protocol` 1.140s, `internal/terminal` 12.858s).
  - Focused concurrency/negative suite with `-short -count=20`: PASS (`internal/endpoint` 2.230s).
  - Final `gofmt -d` on changed Go files, `git diff --check`, product `git show --check`, changed-path review, and stale fixed-cap/ninth/reservation scan: PASS; no output/findings.
  - Race mode remains unavailable because no supported C compiler/`gcc` exists in PATH; none was installed. Repeated synchronized concurrency tests are the applicable local evidence.
- Independent reviewer: `/root/s03_uncapped_review` reviewed exact product `e13c4c8d2659125476c7458b45720892ee49fc24` read-only and returned PASS with no findings.
- Operations: no live agent, listener, Tailscale policy, Funnel, certificate, deployment, or network state was changed; no terminal plaintext, credentials, pairing material, or secrets were recorded.
- Queue/integration: Session 01 alone may transition the authoritative task queue; Session 06 must independently reproduce exact-commit evidence before `verified` or release claims.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S03-003 final remediation handoff (2026-08-26)

- Final cumulative product tip: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c` (ancestry includes `0e655bcbd03ca6e253d659f358dbf4d939e63ad6`, `63bae2286c9430d4706cc5afab68aaff2667f06e`, `c008604e66907a5c2d138dc801ce93f4881fbf64`, `6f428f1b4df618d4fd9e18569d80b5bdb564a8b9`, and exact S03-002 `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`).
- Final implementation hardening: DPAPI CurrentUser encrypted store with atomic replacement and bounded cross-process lock; strict UUID-namespaced revocation markers consumed by the running endpoint; verified mTLS client-certificate fingerprint device identity; request-bound bounded approval that aborts on expiry; all-mode elevation refusal; pre-bind loopback validation; TLS 1.3/system-root server certificate validation; cleanup joins revocation before reset and joins all independent errors.
- Final checks on non-elevated Windows NT `10.0.26200.0` as `sai\\saira` using verified temporary Go 1.25.12 (not installed): `go fmt ./...` PASS; `go vet ./...` PASS; `go test -short -count=1 ./...` PASS; `go test -count=1 ./cmd/integration-host ./internal/protocol ./internal/endpoint ./internal/terminal` PASS; `go test -short -count=20 ./internal/endpoint` PASS (`24.342s`); exact protocol verifier from `910b69e...` PASS (`22 transcripts`, `27 fixtures`, `1 positive`, `4 negative`).
- Host-specific evidence: DPAPI round-trip/encrypted-at-rest/delete/reset, untrusted self-signed rejection, explicit pre-bind wildcard/LAN rejection, non-elevated process assertion, missing verified client rejection, and no-certificate startup refusal all PASS. Existing exact S03-002 suites provide authenticated WSS, origin/subprotocol, replay/oversize, lifecycle/cleanup, listener scope, and secret/log-redaction coverage. `CGO_ENABLED=1 go test -race ...` unavailable because `gcc` is absent; no compiler installed. Repeated concurrency suite passed.
- Read-only environment check: one current-user server-auth certificate candidate (`CN=localhost`) is self-signed and fails trusted-chain verification; it was not used. No non-loopback listener was observed. Tailscale CLI status was unavailable. No listener/publication, certificate installation, service, deployment, Funnel, DNS, or policy mutation occurred.
- External blocker: no already-trusted server certificate/hostname, client-CA bundle, exact approved browser Origin, or independently approved Tailscale-private publication mapping is available. Therefore no endpoint was started and `coordination/requests/from-03-to-02-s02-002-real-wss-endpoint-ready.response.md` was intentionally not created. Producing it requires a separate Session 03 consumer-wiring task assigned by Session 01 plus explicit authorization for local execution using externally trusted certificate/client-CA inputs; publication/policy remains outside Session 03 authority.
- Independent reviewer: `/root/s03_002_readonly_review` reviewed exact tip `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c` read-only and returned PASS with no severity findings; `git diff --check 29a8f7c..b52e3bb` passed.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S03-004 authorized endpoint-ready handoff (2026-08-30)

- Current task: `S03-004` — Run the authorized private integration host with supplied trusted inputs.
- State: owner/reviewer `done`; Session 01 owns the queue transition and Session 06 owns later `verified` evidence.
- Queue authorization: `e9b6dd023178c18638e03b96cfd0543670c7d7f3`; dependencies S03-003 and S06-006 were owner-done before startup.
- Exact implementation input: `e13c4c8d2659125476c7458b45720892ee49fc24`; exact S03-003 host dependency `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`; S06-006 Origin product `14ecdd5cbaf00b75dfeec6f7391038a66f391dd5`.
- Product/evidence files: `apps/windows-agent/evidence/S03-004-endpoint-ready-20260830.md` and immutable endpoint-ready responses to Sessions 02 and 05 under `coordination/requests/`.
- Runtime: non-elevated `sai\saira` on Microsoft Windows NT `10.0.26200.0`; host remains attached to the operator session with process PID 5384 and only `127.0.0.1:8443` listening at handoff time.
- Endpoint: `wss://sai.tailf8dcea.ts.net/terminal`; exact allowed Origin `https://terminus-web.vercel.app`; subprotocol `terminus.v0_1`; TLS 1.3 and verified client certificate required; DPAPI CurrentUser protected-store path is explicit and remains out of the repository.
- Certificate result: the existing server certificate/key pair passed load, hostname, ServerAuth, and current-user trust validation. The existing browser leaf is time-valid, verifies to the supplied client CA, and has explicit ClientAuth EKU `1.3.6.1.5.5.7.3.2`. No certificate was generated or installed.
- Live evidence:
  - Existing installed Terminus ClientAuth identity: `/healthz` returned `ok` and HTTP 200 over the tailnet-only raw-TCP path.
  - No client certificate: curl failed closed with exit 56 and HTTP status 000.
  - Supplementary direct-loopback lifecycle instance `127.0.0.1:56244`: mTLS `/healthz` returned HTTP 200; after Ctrl+C the port was closed and no credential-store file existed.
  - Host output scan found only fixed listener/health metadata and generic loopback TLS EOFs; no terminal plaintext, command, pairing material, credential, proof, token, private key, PFX password, or reusable hash appeared.
- Deterministic commands on Go `1.26.7` Windows AMD64:
  - `go vet ./...`: PASS.
  - `go test -short -count=1 ./...`: PASS.
  - `go test -count=1 ./...`: PASS, including real Windows ConPTY cleanup.
  - `go test -short -count=20 ./internal/endpoint`: PASS in 24.451 seconds.
  - `gofmt -l .` listed 16 unchanged files due the existing CRLF materialization; no source was rewritten and the worktree was clean before evidence changes.
  - A sandboxed live reset attempt failed closed with `integration host unavailable` and made no store change. Live deletion of the persistent store was not retried; deterministic DPAPI reset/delete/revocation tests passed.
  - `git diff --check`, product `git show --check`, exact changed-path review, and credential/plaintext scans: PASS.
- Independent reviewer/evidence: `/root/s03_004_host/s03_004_review` reviewed exact product `ce5ac98b8a79abd42fee6083345709c77aaf669c` and returned PASS. The reviewer reproduced author/committer identity, exact dependency/queue checks, clean owned scope and secret scan, `go vet`, the full Go suite, targeted integration-host 5/5 and endpoint 7/7 suites, loopback-only PID 5384, tailnet-only raw TCP forwarding with Funnel not public, and fail-closed no-client behavior. The reviewer did not independently reproduce the positive HTTP 200 and labels it owner/coordinator evidence.
- Once-per-device acceptance: importing/selecting the client certificate and completing pairing is a one-time device setup. Authenticated reconnect/resume must reuse that client identity and stored credential without another certificate import or local pairing prompt. The server reuses stored credential state on authenticated reconnect; browser-level silent certificate reuse still requires Session 02/06 Chrome, Firefox, Android, and iPhone evidence and is not claimed here.
- Scope: no Tailscale/DNS/firewall/grant/Funnel change, certificate generation/installation, LAN/public listener, deployment, merge, push, terminal input, or pairing-code output occurred. The primary host remains live for downstream owner and verifier checks.
- Product/task commit: `ce5ac98b8a79abd42fee6083345709c77aaf669c`.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S03-006 stalled-open isolation handoff (2026-08-30)

- Current task: `S03-006` — Keep stalled terminal creation from blocking unrelated session lifecycle.
- State: owner/reviewer `done`; Session 01 owns the queue transition and Session 06 owns later `verified` evidence.
- Queue assignment: Session 01 commits `e9b6dd023178c18638e03b96cfd0543670c7d7f3` / `4dba7fe`; exact dependencies S03-005 product `e13c4c8d2659125476c7458b45720892ee49fc24` and S05-007 review product/status `cec6ea3467e1a8b3eb31920280b91eb30c60fa7a` / `d34243a93c30690f3a450924976046133c0aad13` were owner-done.
- Finding remediated: `S05-007-AVAIL-001`. `Adapter.Open` no longer runs under the registry-wide mutex. Each open registers a cancellable pending admission, creates the terminal unlocked, then atomically revalidates permanent shutdown, owner connection state, and credential revocation before registration. An invalid late terminal is canceled and closed without becoming active.
- Lifecycle behavior: unrelated input, resize, close, disconnect cleanup, credential revocation, and shutdown remain prompt while an adapter ignores cancellation. Disconnect and shutdown cancel matching pending contexts without waiting. Endpoint credential revocation records the revoked credential and closes active sessions, emits fatal generic `AUTHENTICATION_FAILED`, then connection shutdown/disconnect cancels the pending open; this prevents `SESSION_OPEN_FAILED` from winning `failOnce`. A late-returning broken adapter is still closed by final revalidation.
- No-cap behavior: 24 simultaneous stalled admissions all reached the adapter and were admitted after release; no count predicate, capacity reservation, eighth/ninth boundary, or replacement fixed limit was added.
- Files changed: `apps/windows-agent/internal/endpoint/session.go` and `apps/windows-agent/internal/endpoint/endpoint_test.go` only.
- Independent test authors:
  - `/root/s03_004_host/s03_004_review` owned only `endpoint_test.go` for the base remediation: deterministic channel-barrier coverage for stalled open versus input/resize/close/disconnect/revocation/shutdown, invalid late return, 24 concurrent admissions, and stored-credential reconnect.
  - `/root/s05_005_independent` owned only the endpoint-level revocation/open ordering test: fatal `AUTHENTICATION_FAILED` (not `SESSION_OPEN_FAILED`), prompt cancellation through disconnect, late terminal closed, and active/pending counts zero.
- Once-per-device acceptance: `TestStoredCredentialReconnectDoesNotRepeatLocalPairingApproval` pairs once, closes the first WSS connection, authenticates a new connection with the stored credential challenge/proof, and proves the local approval callback remains exactly one. Browser certificate import/selection/persistence is explicitly outside this server test and remains Session 02/06 physical-browser evidence.
- Owner commands/evidence on non-elevated Microsoft Windows NT `10.0.26200.0` with Go `1.26.7` Windows AMD64:
  - Four new stalled-open groups once and `-short -count=20`: PASS.
  - Stored-credential reconnect test `-count=20`: PASS.
  - Endpoint-level revocation/open ordering test `-count=20`: PASS.
  - `go vet ./...`: PASS.
  - `go test -count=1 ./...`: PASS across integration host, endpoint, protocol, and real Windows ConPTY/process-cleanup suites.
  - `go test -short -count=20 ./internal/endpoint`: PASS in 26.462 seconds on the cumulative product.
  - `gofmt -d` on both changed files, `git diff --check`, product `git show --check`, changed-path ownership review, fixed-cap scan, and credential/plaintext scan: PASS.
  - `CGO_ENABLED=1 go test -race ...`: unavailable; the installed toolchain reported `runtime/race: package testmain: cannot find package`, default CGO is disabled, and `where.exe gcc` found no compiler. No compiler was installed. Deterministic barrier suites and repeated synchronized tests are the applicable local concurrency evidence.
- Product history: immutable intermediate `b8bde676059d75b571deb3d8c0cbfe5d5f619ee1` introduced unlocked creation/revalidation and the base tests. A pre-review owner audit found the revocation failure-order race; cumulative follow-up `0446e685489d2e9d09715d6cc5ba011a5471a540` preserves authentication-failure ordering and adds the independent endpoint-level regression without rewriting the intermediate commit.
- Independent reviewer/evidence: `/root/s03_006_independent` reviewed exact cumulative product `0446e685489d2e9d09715d6cc5ba011a5471a540` and returned PASS with no findings. The reviewer reproduced the focused seven-test suite `-count=20`, endpoint short suite `-count=20`, vet, full Go/real-Windows suite, formatting, diff/ownership, author, and secret checks; static race/deadlock review confirmed atomic registration, prompt lifecycle operations, permanent revocation/shutdown rejection, late cleanup, one-time approval reuse, and no fixed cap. Race-build unavailability was independently retained.
- Live boundary: the existing S03-004 PID 5384 remained loopback-only and untouched while the source fix was made; it still runs the earlier compiled binary at this handoff. Replacement with the exact cumulative source and repeat mTLS allow/deny/listener checks must be coordinated after this status commit so downstream sessions are not interrupted mid-check.
- Scope: no protocol/schema change, terminal plaintext, pairing-code output, certificate generation/installation, Tailscale/DNS/firewall/grant/Funnel change, LAN/public listener, deployment, merge, or push occurred.
- Product/task commit: `0446e685489d2e9d09715d6cc5ba011a5471a540` (cumulative; includes `b8bde676059d75b571deb3d8c0cbfe5d5f619ee1`).
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.
