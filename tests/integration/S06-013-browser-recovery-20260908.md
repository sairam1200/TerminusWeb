# S06-013 independent browser recovery verification

Verdict: PASS for the exact consumer sources and deterministic checks below.
This is independent consumer verification, not an assembled release or live-host
test. Session06 owns only the test fixtures, this report and evidence images.

## Exact inputs and source review

- Architecture S01-016: `b5d1ddf775aca61902cb8c7dd5246e5c520ee7b9`, with legacy
  error clarification `f1f510637557220d8c7dd1c33721f7bc7b18cd66` and retry-budget
  clarification `8d1dcf0`. Reviewed independently against the actual consumers.
- Agent cumulative product `2c64e013d3643951fa459dd7ab40b53f74c57e3a`, including
  initial `040f39081b0ca25b228b99af3e2e15e08dca4297`; owner handoff
  `2ac1b1f990adf5cde11eb30e6548486d59214106`.
- Web cumulative product `0a6f4281b9299dd4d6267e5668a53e262a96ddd6`, including
  initial `d46506700735ce2485aaa653286954b83828a502`. Final checks ran in isolated
  detached checkout `E:/terminus/.worktrees/s06-recovery-web-final`, with locally
  copied installed dependencies. No installation or lockfile change.
- Baseline: web and agent from `a49e2779c186f4fc48247718b7209f5e2275e291`.

Source review found no remaining blocker. Transient transport loss releases the
socket without sending the old fatal frame and retains the chosen locator.
The host promptly detaches validated operational error reports; genuine internal
session-open failures and client sequence violations still destroy their session.
The legacy client SESSION_OPEN_FAILED exception is restricted to the received
error handler, preserving older-client compatibility without changing the wire
schema or global error classification. Late old transport cleanup cannot remove
a replacement owner. Device/credential ownership checks remain unchanged.

Recovery has eight attempts, capped 16-second exponential delays totaling
63.5 seconds, pauses hidden/offline, resets after success, and does not rearm an
exhausted episode through lifecycle events. The duration accounts for the host's
45-second liveness threshold checked on a 15-second tick. Native socket opening
has a generation-guarded 10-second timeout. Explicit recent-session selection
takes precedence over an older remembered active locator.

Recent storage contains at most 20 validated locator/timestamp records, scoped
to endpoint/origin/mode and public credential ID. It contains no terminal output
or authentication secret, cannot choose arbitrary WebSocket destinations, and
does not automatically connect when visiting the root page. Disconnect detaches;
End Terminal explicitly closes; New Session discloses close-and-replace behavior.

## Commands and outcomes

Final isolated web checkout, `apps/web`:

```powershell
npm test
npm run typecheck
npm run lint
$env:NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT = 'wss://sai.tailf8dcea.ts.net/terminal'
$env:NEXT_PUBLIC_TERMINUS_WEB_ORIGIN = 'https://terminus-web.vercel.app'
$env:NEXT_PUBLIC_TERMINUS_CONNECT_MODE = 'private'
npm run build
```

PASS: 151 tests across 18 files; typecheck and lint exit 0; Next.js 16.3.3
production build exit 0, ten static routes. Public values were process-only;
local-profile variables were unset. No secret configuration was loaded or printed.
`git diff 0a6f428 --exit-code -- apps/web` and clean status passed afterward.

Final agent owner checkout, `apps/windows-agent`:

```powershell
go test -count=1 ./...
go vet ./...
go test -count=20 -run 'TestBrowserLossPreservesSameShellAndOrderedBackgroundOutput|TestClientFatalProtocolErrorStillDestroysOwnedShell' ./internal/endpoint
```

PASS: all five Go packages (host 0.855s, endpoint 5.664s, intelligence 0.158s,
protocol 0.474s, terminal 6.557s); vet exit 0; repeated focused tests 1.796s.
The full suite includes actual Windows ConPTY/process cleanup tests. Exact agent
source parity and clean status passed. Five optional PostgreSQL cases remain
skipped without `TERMINUS_INTELLIGENCE_TEST_DATABASE_URL`; CGO is disabled and
race-mode verification remains unavailable, as recorded in S06-011/S06-012.

Final isolated checkout, `packages/protocol`: `npm run verify` PASS. Protocol
0.1: 22 transcripts/27 fixtures; 0.2: 23 transcripts/32 fixtures. Each includes
one positive authentication vector and four negative mutations.

## Independent cross-consumer regression

From the Session06 worktree:

```powershell
./tests/integration/recovery-fixture/run.ps1 -AgentCommit 2c64e013d3643951fa459dd7ab40b53f74c57e3a -WebCommit 0a6f4281b9299dd4d6267e5668a53e262a96ddd6 -WebRoot E:/terminus/.worktrees/s06-recovery-web-final/apps/web
```

PASS, exit 0. The script archives the exact agent, adds only the independent
fixture inside its internal import boundary, builds and vets it, then exercises
the unchanged TypeScript adapter against the real Go endpoint over loopback TLS.
Node trusts only the fixture's public test CA using the ordinary `ca` option.
No TLS bypass, global trust installation, external network or real shell exists.
The PTY, credential store and device resolver are explicit synthetic boundaries.
Installed TypeScript and Playwright's bundled WebSocket implementation are used;
their local APIs were inspected, with no dependency addition.

After invoking onerror on a real writable socket, waiting 2.2 seconds and emitting
synthetic background output, reconnect returned the same locator, one opened and
zero closed PTYs, zero fatal client frames, and ordered history replay. Releasing
that adapter and creating a fresh adapter with the same stored credential and
explicit locator again returned the same PTY/history without pairing.

The same independent scenario against the unchanged baseline failed as expected:
sameSession=false, opened=2, closed=0, fatalFrames=1, orderedHistory=false,
reopenFrames=0. This proves replacement/history loss, not immediate destruction
of the old host PTY. Initial harness setup failures (unavailable standalone ws
module and inappropriate private-mode loopback policy) were corrected using the
installed bundled implementation and existing local-mode contract before this
baseline result; no product policy was relaxed.

An intermediate run at d465067 overlapped the maker's explicit-target correction.
Its source-parity guard correctly failed; neither its behavioral result nor its
web checks count as final evidence. Final verification used the isolated immutable
checkout. Two completed harness exit results were lost during context truncation;
the short harnesses were rerun to retain both final exit-0 outcomes.

## Browser component evidence

```powershell
node tests/browser/session-recovery/verify.mjs E:/terminus/.worktrees/s06-recovery-web-final/apps/web E:/terminus/tests/browser
```

PASS, exit 0: Chromium at 1440x1000 and touch-enabled 390x844, EN/SV. The actual
TerminalShell, recovery controller and styles run on loopback 127.0.0.1:4193 with
an explicitly synthetic adapter. The harness proves no automatic initial
connection, explicit recent selection, same-session recovery after simulated
hidden/pagehide and visible/pageshow events with a 2.2-second pause, retained
recent entry and no automatic reconnect after Disconnect, and removal of the
entry/fragment after End Terminal. Both viewports report zero page errors,
external requests and horizontal overflow. Four deliberate screenshots are under
`tests/browser/output/playwright/S06-013/`; mobile text/actions were visually
inspected as readable and wrapped. This is lifecycle-event simulation, not an
actual mobile OS suspension or physical device test. Browser/server close in
finally; fixture child shutdown is bounded. Vite cache is ignored under tmp.

## Remaining limits

- No live production WSS, Tailscale path, live PID19980, certificate, deployment,
  private terminal input/output or physical phone was accessed or changed.
- History remains bounded host memory, not durable archival. Host restart,
  expiry/revocation, explicit close and fatal protocol errors may end sessions.
- The new timeout bounds native socket opening; a socket that opens but never
  completes hello/authentication is not fully proven bounded by this work.
- Independent browser instances still share the host's existing credential/device
  reopen throttle. There is no concurrent shared-session takeover.
- Browser component tests use a synthetic adapter; cross-consumer tests use a
  synthetic PTY/store/resolver. Neither is production end-to-end proof.
- No integrated candidate is claimed here. Root must review this immutable
  evidence; Session01 owns queue transitions and any separately authorized
  assembly/release.
