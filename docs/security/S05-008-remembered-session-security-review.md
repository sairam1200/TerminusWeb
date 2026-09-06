# S05-008 remembered-session isolation and history-privacy review

Status: owner review complete with one release-blocking Medium resource-bound
finding. This is Session 05 `done` evidence only after named independent review;
it is not Session 06 verification or release approval.

## Exact inputs and scope

- Authoritative queue/request: Session 01 commit
  `464ce763890ef305cc4e4d4dab423fd86796bb12`.
- Protocol/security 0.2 cumulative product
  `f9a70299974734c3eeb920697d2dfa4717148a9a`; Session 01 handoff
  `14a613b2fd5149cd7f3f5fd0fb17a2cbce57f90c`.
- Web cumulative product `d8a9b52d3448958d8c1a53eeb7a5ee378813eff9`;
  Session 02 handoff `70666fac1fc9f696f630e91f947028b6c499a2ab`.
- Windows-agent cumulative product
  `92a29e1673751893d3ef0b5ee9c937b91d0f93d0`; Session 03 handoff
  `a1a5c62874e2551ade3d994c056167007e8cdb64`.
- Product-to-handoff tree parity passed for `packages/protocol`,
  `packages/security`, `apps/web`, and `apps/windows-agent`. Exact
  `git show --check` passed for all three cumulative products.

The review was offline and read-only against product paths. Reviewer-owned
tests use Go's overlay facility to compile beside the exact endpoint package
without changing Session 03 files. No product code, browser, host, terminal,
credential, certificate, listener, Tailscale policy, network path, Git remote,
or deployment state was changed or inspected.

## Verdict

The remembered-session authorization and privacy design otherwise fails
closed in the tested scope. Session IDs are canonical 60-bit CSPRNG-generated
locators, not capabilities. Unknown IDs, wrong credentials, wrong or missing
source-device identities, attached sessions, closed sessions, and concurrent
losers receive the same local rejection class; exactly one concurrent owner
can claim a detached session. Rejection throttling remains credential-and-
device scoped.

History offsets, per-session eviction, global oldest-history eviction,
discarded-byte exclusion, lifecycle fences, and New Session invalidation pass
their exact deterministic suites. The browser accepts only `#/s/{id}`, clears
before replay, rejects offset faults through its contract machine, persists no
terminal data through its credential database, Web Storage, or service worker,
and installs OSC 8/9/52/777 handlers that consume navigation, notification,
and clipboard side effects. New Session retains the old fragment through
failure and replaces it only after a new `session_opened`.

One contract violation remains: an eager replay snapshot is copied outside the
agent-wide history accounting. The independent local overlay test retains
50,331,648 copied snapshot bytes while the registry's accounted live history
correctly remains at 16,777,216 bytes. The replay queue and write deadline are
bounded, but the number and aggregate size of simultaneous copied snapshots is
not governed by the promised agent-wide byte budget. This is a Medium
availability/resource-isolation issue and blocks S06-007 until Session 03
remediates it without adding a fixed session-count cap.

## Finding

### S05-008-RESOURCE-001 — replay snapshot copies escape aggregate accounting

- Severity: Medium availability/resource isolation; release-blocking for
  S06-007.
- Affected input: Session 03 product
  `92a29e1673751893d3ef0b5ee9c937b91d0f93d0`,
  `apps/windows-agent/internal/endpoint/session.go`.
- Evidence: `snapshotLocked` eagerly copies retained chunks into
  `reopenSnapshot.frames`. These bytes are not included in
  `sessionRegistry.historyBytes`, are not reserved against
  `protocol.MaxAgentHistory`, and remain reachable while replay output waits.
- Reproduction: reviewer test
  `TestS05008StalledReplaySnapshotCopiesExceedAgentBudget` uses only local
  in-memory endpoint doubles and reports 50,331,648 retained snapshot bytes
  alongside the correctly capped 16,777,216-byte live history ring.
- Impact: an already authenticated private principal can cause replay memory
  to exceed the explicit aggregate volatile-history limit, weakening the
  intended containment boundary.
- Required owner action: account all replay-retained terminal bytes under a
  deterministic agent-wide byte budget, release reservations on every replay
  exit/fence, preserve global-oldest semantics and running sessions, and keep
  admission free of a fixed session-count limit. Add repeated concurrent tests
  for completion, backpressure, revocation, expiry, process exit, and shutdown.
- Owner request:
  `coordination/requests/from-05-to-03-s05-008-replay-snapshot-budget.request.md`.

## Security matrix

| Case | Expected | Evidence | Result |
| --- | --- | --- | --- |
| ID entropy and syntax | 60 random bits, canonical `xxxx-xxxx-xxxx`, collision check before terminal creation | Exact protocol verifier and agent ID test | Pass |
| Locator enumeration | Unknown and non-owned IDs reveal no ownership oracle | Reviewer uniform-denial test plus exact reopen-rate test | Pass in deterministic scope |
| Credential/device ownership | Same unexpired, unrevoked credential and non-empty exact source-device identity required | Reviewer wrong/missing owner cases and exact endpoint tests | Pass |
| Concurrent claim | At most one attached owner | Reviewer 16-contender barrier and exact agent concurrency test | Pass |
| Close/revoke/expiry/process/shutdown races | Fence ownership before potentially blocking cleanup/replay | Exact Session 03 blocked-cleanup tests repeated 20 times | Pass |
| Per-session history | At most 262,144 latest bytes; discarded bytes unavailable | Reviewer boundary test and exact history-budget test | Pass |
| Live global history | At most 16,777,216 bytes; oldest bytes evicted without closing sessions | Exact history-budget test | Pass |
| Replay-copy global history | All retained replay copies remain inside an aggregate byte bound | Reviewer overlay test | **Fail: S05-008-RESOURCE-001** |
| Offset ordering | Snapshot and live offsets are contiguous; gaps, overlaps, wrong IDs, and overflow fail closed | Protocol fixtures, web contract machine, and focused web tests | Pass |
| Browser persistence | No terminal output/history in IndexedDB, Web/Cache Storage, service worker, logs, analytics, or URLs sent to Vercel | `terminalPersistence.test.ts`, source review, fragment tests | Pass in application-source scope |
| Renderer side effects | Replay/live bytes cannot trigger clipboard, navigation, notifications, or external loads | Consuming OSC 8/9/52/777 handlers and component test | Pass for enabled xterm feature set |
| New Session | Old ID/history closes first; fragment changes only after fresh open; failure is explicit | Protocol lifecycle fixtures and web adapter/component tests | Pass |
| Private transport boundary | Exact Origin, TLS/mTLS, private path, no Funnel/public/LAN listener remain unchanged | Exact change-scope review; no live assertion | Unchanged contract boundary |

The browser source has transitive OpenTelemetry package references through the
Next.js lockfile, but no application telemetry, analytics, crash-reporting, or
console output path consumes terminal data. Browser/OS crash dumps remain an
explicit host-platform residual rather than an application persistence claim.

## Reproduced commands and outcomes

Installed tools were Node.js `v24.15.0`, npm `11.14.1`, and Go `go1.26.7
windows/amd64`. Dependency APIs and versions were taken from the exact
lockfiles, Go module files, and compiled exact source.

```text
npm run verify
PASS: protocol 0.1 — 22 transcripts, 27 fixtures, 1 positive auth vector,
4 negative mutations; protocol 0.2 — 23 transcripts, 32 fixtures,
1 positive auth vector, 4 negative mutations.

npm test -- protocol/sessionFragment.test.ts protocol/terminalPersistence.test.ts protocol/canonicalFixtures.test.ts terminal/protocolTerminalAdapter.test.ts components/TerminalShell.test.tsx
PASS: 5 files, 45/45 tests.

go test -short -count=1 -v -overlay <temporary-overlay> -run '^TestS05008' ./internal/endpoint
PASS: 3 reviewer tests. Uniform ownership denial/atomic claim and eviction
boundaries pass; the local resource-bound test positively reproduces
S05-008-RESOURCE-001 at 50,331,648 copied bytes versus 16,777,216 accounted
live-history bytes.

go test -short -count=20 ./internal/endpoint -run '<remembered-session ownership/history/lifecycle group>'
PASS in 19.387s.

git diff --quiet <product>..<handoff> -- <owned product paths>
git show --check <each exact product>
git diff --check
PASS.
```

The initial sandboxed Vitest attempt failed before test discovery with Windows
`spawn EPERM`; the same exact command passed outside that sandbox restriction.
All test transports were local deterministic doubles or loopback test servers
already present in the exact source suite. `tailscale ping` was not run and
would not prove the application endpoint. No physical Chrome, Firefox,
Android, iPhone, certificate-selection, or deployed integration claim is made.
