# S06-008 independent recovery verification

Result: PASS for local branch consolidation and the focused UI/agent repairs.
This is not private-terminal release verification. Reviewer: `/root/verification`,
independent of Session 02 and Session 03 makers. Date: 2026-09-06.

## Exact candidates

- Combined candidate: `a5f3227d7733b403eb26b68bc6ef4fc65bfe152c`.
- Web cumulative product: `9ddbd0bf213d3be9f218b33624c1386ebf783437`.
- Windows-agent repair: `c4c8a828a432773f5da28d5fd84f69b9d172e106`.
- Initial independent harness checkout: `f0477a7cd6e4b250fa2437dc2a5bdfa23b26b817`.
- `git diff --exit-code` comparing combined `apps/web` with the web product and
  combined `apps/windows-agent` with the agent product: both exit 0.

## Independently reproduced checks

Environment: Windows; Node 24.15.0; installed Playwright 1.62.1 from the
lock-identical Session 06 dependency tree; local Chromium. No external API used.

- `git for-each-ref --format='%(refname)' refs/remotes`, followed by
  `git merge-base --is-ancestor <ref> <combined-candidate>` for each: all 20
  current source/recovery/origin refs are ancestors, all exit 0.
- `git grep -n -E '^(<<<<<<< |=======|>>>>>>> )' <combined-candidate> -- .`:
  exit 1, no tracked conflict markers.
- CI `.github/workflows/session-06-harness.yml` is present and unchanged from
  `source/session/06-verification-release`; its three labelled harness jobs
  remain. GitHub CI was not run.
- Protocol/security artifacts and architecture/shared-contract documents match
  `source/session/01-architecture`; both protocol 0.1 compatibility evidence
  and protocol 0.2 remembered-session contracts remain. Initial agent tree
  matched `source/session/03-windows-agent` before the focused expiry repair.
- `npm test` in `tests/browser`: exit 0, 24/24, zero skipped, desktop and
  iPhone-sized Chromium. This existing harness uses its own labelled double,
  not the production UI or real agent. Initial sandbox attempt failed
  `spawn EPERM`; unchanged escalated rerun passed.
- `npm run lint` in `tests/browser`: exit 0, 18 source modules and 9 JSON files
  before the new smoke script. Initial sandbox spawn denial was resolved by
  the unchanged escalated rerun.
- `npm test` in the exact web product checkout: exit 0, 9 files, 74/74 tests,
  zero skipped (final run 10:57:58, duration 6.38 s).
- Agent command: process-scoped `GOTELEMETRY=off` and a writable workspace
  `GOCACHE`, then `go test ./internal/endpoint -run
TestGeneratedCredentialExpiresInsideThirtyDayClientBoundary -count=1`:
  exit 0, 0.677 s. Initial default-cache attempt failed access checks. The
  rerun printed a telemetry token access warning but the test passed. This
  focused test does not launch ConPTY or a private host.

## Actual production UI smoke

The maker's no-endpoint production `.next` build of exact web product was
served by `node node_modules/next/dist/bin/next start --hostname 127.0.0.1
--port 4188`, with process `NEXT_PUBLIC_*` variables unset. This is the actual
Next UI with its explicitly labelled local `MockTerminalAdapter`.

`node recovery-ui-probe.mjs` from `tests/browser`: exit 0 at both 1440x1000
desktop and 390x844 iPhone-sized Chromium. Checks cover no horizontal overflow,
configuration controls, accent selection, font sizing, English/Swedish toggle,
simulation start, Tab shortcut focus restoration, rotation, disconnect, and
restart. Both contexts reported zero page errors, zero console warnings/errors,
zero off-loopback requests, and the production `connect-src 'self'` CSP.

Disconnected screenshots were independently visually inspected. They contain
no real terminal contents and show no development overlay:

- [Desktop](disconnected-1440.png)
- [iPhone-sized](disconnected-390.png)

Earlier development screenshots showed a Next debug badge because development
React attempted an eval-based debugging feature blocked by the restrictive
CSP. The final production run has no such warning and replaced those artifacts.

## Findings resolved before PASS

1. Profile selection could validate a profile against its own expected origin
   and then throw during adapter construction on the actual page origin.
   `e0cd688006fc5cfbd1bd6add7adbbbd713b979cb` selects compatible profiles,
   disables incompatible options, and renders an accessible configuration error
   when none match. Actual-constructor regressions preserve fail-closed policy.
2. The actual UI Tab shortcut left focus on its button, interrupting typing.
   The smoke test failed its focus assertion. `9ddbd0b` adds shortcut-only
   refocusing of xterm or simulation input; final same assertion passes.
3. Agent `c4c8a82` restores five-minute credential-expiry clock-skew headroom
   within the 30-day maximum. Focused review found no lifecycle downgrade.

The first smoke draft also used an incorrect English selector while the UI was
Swedish; correcting it to the actual `Byt till engelska` label was a harness
correction, not a product repair. No existing test was removed or weakened.

## Recovery script review and limitations

Read-only review of `merge-work/recovery-20260906/Restore-Root.ps1`: PASS for
the inspected recovery scope. It checks exact clean assembly, preserves root
tracked files and a Git bundle before overwrites, retains untracked files,
preserves source branches including original main, and performs no deletion.
Review recommendations were incorporated: refuse an existing publication
backup and require protected governance/skill files to be identical. This
report does not claim execution of root recovery; the coordinator owns that.

Known `S05-008-RESOURCE-001` remains release-blocking. This report does not prove
real-agent resource exhaustion, private WSS, mTLS, Tailscale policy, certificate
reuse, ConPTY, Safari, physical iPhone, live remembered-session replay, or the
end-to-end private terminal. No deployment, push, certificate/network change,
live host start, or terminal input to a real shell occurred. Existing labelled
double results are not a substitute for these gates.
