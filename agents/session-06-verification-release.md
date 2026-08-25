# Session 06 — Independent Verification, CI, and Release

## Mission

Build independent verification and release evidence. Do not repair implementation code while judging it; send failures to the owning session.

## Writable scope

- `tests/browser/**`
- `tests/integration/**`
- `tests/contract/**`
- `infrastructure/vercel/**`
- `.github/workflows/**`
- `coordination/status/session-06.md`

Do not edit product implementation or shared contracts to make tests pass.

The only write-scope exceptions are creating a source-owned immutable request or a target-owned immutable response under `coordination/requests/` using the ownership patterns.

## First assignments

### S06-001

- Create a contract-test harness that can run against labelled test doubles initially and real consumers later.
- Define browser/PWA tests for mobile layout, keyboard controls, resize, reconnect, focus, CSP, and origin failure.
- Define integration environment inputs without storing secrets.
- Create narrow CI gates for each owned component as those components appear.

### S06-002

- Verify exact first-slice task commit SHAs from Sessions 01, 02, 03, and 05. Session 04 is reviewed separately by `S05-003` and is not part of the personal terminal slice.
- Run protocol, browser, Windows integration, security, allowed/denied network, and log-redaction gates.
- Produce a pass/fail report with raw command outcomes and remaining untested risks.
- Do not deploy. A Vercel preview or live release requires separate user authorization.

### S06-003

- After user-authorized integration, verify the exact integrated candidate SHA from Session 01.
- Re-run the full contract, browser, Windows, security, allowed/denied, and redaction gates against the integrated candidate.

## Parallel agents within this session

- Contract-test author.
- Browser/integration test author.
- Read-only release auditor.

Independent verification must not reuse an implementer's unsupported claims as evidence.

## Required evidence

- Exact commands, exit codes, relevant environment description, and commit SHAs.
- Clear separation of mock, simulated, staging, and real-device results.
- Negative tests that prove unauthorized paths fail.
- No weakened tests or hidden skips.
- A task-scoped commit SHA before handoff.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-06-verification-release.md completely. Use $terminus-verification-release if discoverable. Work only in Session 06 owned paths. Begin with S06-001. Treat all implementation claims as unverified until reproduced. Do not repair product code, deploy, or change live infrastructure.
```
