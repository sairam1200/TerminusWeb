# S05-007 uncapped multi-session abuse and isolation review

Status: owner review complete with one release-blocking availability finding and
one explicit verification gap. This is Session 05 `done` evidence only; it is
not Session 06 verification.

## Exact inputs and scope

- Authoritative queue: Session 01 commit
  `097b2b085b7df02504d00c8274921db5f6e31885`; it records S03-005 and
  S02-004 `done`, and S05-007 `ready`.
- Governing no-fixed-cap contract: Session 01 product
  `e795c391cbdb7a77c136ce5e15e0577331d436b7`.
- Windows-agent product:
  `e13c4c8d2659125476c7458b45720892ee49fc24`.
- Web product: `bf7ca71b437907e7d25251e54d59355440797ad4`.
- Source parity: the Session 03 handoff tip `00faa091c89b904dc3128a823cbe282e3b48d238`
  has no `apps/windows-agent` delta from the exact product, and the Session 02
  handoff tip `1e52575afeacba4cff2b79567b229b9d84c00686` has no `apps/web` delta
  from its exact product.

The review was read-only against both products. Reviewer-owned tests are added
only under `tests/security`. No web, agent, protocol/security contract, queue,
certificate, listener, Tailscale, Serve/Funnel, deployment, or live state was
changed.

## Verdict

The fixed count of eight is removed without weakening one-terminal-per-
authenticated-connection semantics. Twelve WSS sessions and 24 concurrent
registry admissions pass; first/last input and resize remain isolated. Genuine
adapter errors map to the generic `SESSION_OPEN_FAILED`, and the web gives
accessible English and Swedish resource/agent retry guidance without reviving
count-based advice.

Detached output remains bounded to 65,536 bytes per session. The reviewer test
forces a detached session over that boundary and proves only that session is
closed and removed. Attached and detached sessions for one credential are both
closed and removed on revocation. The existing five-failures-per-device in
five-minutes limiter and five-minute cooldown are atomic under concurrent
attempts.

S05-007 nevertheless has one medium-severity availability/isolation finding:
`sessionRegistry.open` holds the registry-wide mutex across synchronous
`Adapter.Open`. A slow or stalled ConPTY/resource-pressure open therefore
blocks operations on unrelated sessions that require the same mutex, including
input, resize, detach, close, disconnect cleanup, credential revocation, and
agent shutdown. The independent overlay test deterministically reproduces the
cross-session cleanup block. This does not justify restoring a fixed numeric
cap; Session 03 should make terminal creation cancellable and avoid holding the
global registry lock across the potentially blocking adapter call, then
atomically revalidate shutdown/connection state before registration and clean
up a just-created terminal if admission became invalid.

Actual Windows resource exhaustion was not induced because deliberately
exhausting the user's workstation is unsafe. The exact product's
`TestEndpointReportsActualAdapterOpenFailure` uses a synthetic failing adapter,
despite its name. Static inspection confirms that Win32/ConPTY creation errors
propagate through `LocalAdapter.Open`, its deferred failure path releases
partially acquired handles, and the endpoint returns `SESSION_OPEN_FAILED`.
This is useful failure-path evidence, but it is not real OS-exhaustion proof.
Session 06 must not claim that stronger result without a safe deterministic
Win32 fault-injection or constrained test environment.

## Finding

### S05-007-AVAIL-001 — global session registry stalls behind terminal creation

- Severity: medium availability/isolation; release-blocking for S06-005.
- Preconditions: a private, authenticated, authorized client submits
  `open_session`, and `Adapter.Open` becomes slow or stalled during ConPTY or
  system-resource pressure.
- Evidence: exact `session.go` takes `r.mu` before `r.adapter.Open` and releases
  it only after terminal creation and registration. Every existing-session
  lifecycle operation also takes `r.mu`.
- Reproduction: `TestS05007StalledOpenBlocksUnrelatedSessionCleanup` starts one
  existing session, stalls a second `Adapter.Open`, and proves cleanup of the
  unrelated first session cannot complete until the second open is released.
- Impact: one opening session can delay unrelated terminal interaction,
  revocation, disconnect cleanup, and shutdown. The failure mode becomes most
  relevant precisely at resource pressure, where prompt cleanup is needed.
- Required owner action: Session 03 should remediate without a count-based
  admission cap and add concurrency tests for stalled/failing open versus
  input, close, revocation, and shutdown. Session 06 should verify the exact
  remediation before integration.

## Abuse and isolation matrix

| Case | Expected | Evidence | Result |
| --- | --- | --- | --- |
| Positive above-eight admission | More than eight valid authenticated connections may each open one session | Exact product test opens 12 WSS sessions; registry test admits 24 concurrent requests | Pass |
| Cross-session input/resize isolation | One connection cannot alter another session | Exact product exercises first and twelfth sessions with distinct input and dimensions | Pass |
| One terminal per connection | A connection cannot multiplex terminals | Unchanged protocol state machine and exact product endpoint handling | Pass by source/test inheritance |
| Detached accounting | Detached session remains registered until resume, expiry, revocation, backpressure, or cleanup | Exact lifecycle test plus reviewer attached/detached revocation test | Pass |
| Per-session output boundary | Detached output above 65,536 bytes closes only the affected terminal | `TestS05007DetachedBackpressureIsPerSessionAndBounded` | Pass |
| Genuine adapter failure | Creation failure returns generic `SESSION_OPEN_FAILED` without process/session metadata | Exact product synthetic adapter test and web 12/12 UI test | Pass at adapter boundary |
| Actual OS resource exhaustion | Partial ConPTY resources clean up and unrelated sessions remain operable | Static Win32 cleanup review; no safe real exhaustion run; stalled-open test disproves unrelated-operation isolation | Gap / finding |
| Authentication abuse | Sixth concurrent failed attempt for one device is denied until cooldown | `TestConcurrentRateLimitReservations` | Pass |
| Credential revocation | All attached and detached sessions for the credential terminate | Exact endpoint test plus reviewer detached/attached test | Pass absent a stalled concurrent open |
| Revocation/open race | Revocation is prompt even while terminal creation stalls | Global mutex reproduction | Fail: S05-007-AVAIL-001 |
| Connection loss and shutdown | Sessions/process trees terminate; new opens remain denied after shutdown | Exact unit tests and real Windows WSS/ConPTY cleanup test | Pass absent a stalled concurrent open |
| Wrong Origin/subprotocol/non-TLS | Request is rejected before terminal creation | Exact handshake negative tests | Pass |
| Non-loopback listener | Agent rejects wildcard/LAN/tailnet-interface ownership | Exact `ServeTLS` negative test; S03 product does not change server/host paths | Pass (test scope) |
| Public exposure | Funnel/public terminal remain disabled | No network/publication code changed by either product; no live state asserted | Unchanged contract boundary only |

The no-fixed-cap choice leaves an intentional aggregate resource-exhaustion
residual: a private authenticated terminal principal can open sessions until
the operating system refuses creation. That principal already has interactive
PowerShell execution, so this review does not treat a numeric cap as a valid
security fix. Isolation, prompt cleanup, and genuine resource-failure handling
must still remain correct under pressure.

## Reproduced commands and outcomes

All Go commands used installed Go `go1.26.7 windows/amd64` against module
`go 1.25.0`, `github.com/gorilla/websocket v1.5.3`, and
`golang.org/x/sys v0.47.0`; the pinned module set came from the exact product's
`go.mod`/`go.sum`. Web dependencies were the installed lockfile versions,
including Next.js `16.3.3` and Vitest `4.1.11`.

```text
powershell -NoProfile -ExecutionPolicy Bypass -File tests/security/Test-S05-007.ps1 -AgentWorktree E:\terminus\.worktrees\session03-multisession
PASS: 3/3 reviewer overlay tests. The first test positively reproduces
S05-007-AVAIL-001; the other two prove per-session detached backpressure and
attached/detached revocation cleanup.

go test -count=1 -v -run '^(focused S05-007 endpoint cases)$' ./internal/endpoint
PASS: above-eight, concurrent admission, detach/resume, authentication rate
limit, revocation, shutdown, generic open failure, Origin/subprotocol/TLS,
loopback rejection, and real ConPTY-through-WSS cleanup.

go test -count=1 ./...
PASS: cmd/integration-host 1.372s; internal/endpoint 4.236s;
internal/protocol 1.583s; internal/terminal 7.429s.

npx vitest run components/TerminalShell.test.tsx --reporter=verbose
PASS: 12/12 after the sandboxed attempt failed before discovery with Windows
spawn EPERM and the authorized rerun completed outside that restriction.

npm test
PASS: 7 files, 41/41 tests.

npm run typecheck
npm run lint
npm run build
PASS: typecheck and lint; Next.js 16.3.3 optimized static production build.
```

The Go test servers were ephemeral loopback-only `httptest` endpoints using
test-generated certificates. The real Windows test used synthetic markers and
verified process-tree cleanup; no terminal plaintext from a user session was
read or recorded. `tailscale ping` was not run and would not prove application
service access. Live machine approval, key expiry, Serve/Funnel state, client
certificate trust, Android/iPhone browser behavior, and the production WSS path
remain outside this no-mutation exact-source review.
