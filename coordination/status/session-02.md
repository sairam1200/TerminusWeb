# Session 02 Status

- Current task: S02-002
- State: review
- Branch: `session/02-web-renderer`
- Files changed: `apps/web/app/globals.css`, `apps/web/app/layout.tsx`, `apps/web/components/TerminalShell.tsx`, `apps/web/components/TerminalShell.test.tsx`, `apps/web/package.json`, `apps/web/package-lock.json`
- Commands/evidence: same-PC Chrome reached an authenticated non-elevated ConPTY PowerShell session; user reported raw output was garbled; inspection confirmed protocol output chunks were rendered as ordinary paragraphs. Added official `@xterm/xterm` 6.0.0 ANSI rendering and routed native xterm input (including Ctrl+C) to the protocol adapter. `npm test` passed 35/35; `npm run typecheck`, `npm run lint`, and `npm run build` passed in the Session 02 worktree. Vercel production deployment `dpl_Cd5bSehoevVCC5545rH92ygZy6gD` reached `READY` and aliased `https://terminus-web.vercel.app`. Production Chrome confirmed xterm present, legacy markers absent, rendered output with no raw escape or replacement characters, xterm focus and Ctrl+C interaction, stored-credential connection without pairing, resize from 134x21 to 64x9 and restoration, heartbeat cleanup after abrupt refresh, credential reconnect after cleanup, and resize after reconnect. The agent remained loopback-only with one authenticated socket and one ConPTY PowerShell session during the connected checks.
- Independent reviewer/evidence: none yet; product commit remains in review pending maker-independent Session 06 verification.
- Assumptions: xterm.js stable API is the appropriate browser terminal renderer for ConPTY VT output; no protocol or security contract changed.
- Blockers/requests: user visual readability confirmation and maker-independent Session 06 review remain; integration/cherry-pick requires explicit user authorization.
- Product/task commit: `3f5971ba0a394d28fd20e47c63ae468cb8b5986d`
- Handoff commit: resolve from branch HEAD after the status-only handoff commit

## S02-004 handoff (2026-08-27)

- Current task: `S02-004` — Explain the eight-session limit after a rejected new tab.
- State: implementation and owner validation complete; independent review and Session 01 queue transition remain pending.
- Architecture input: Session 01 product `2e309afc90a9c657aa71864252882ae9eb9047c0`; the existing protocol 0.1 `SESSION_OPEN_FAILED` error remains unchanged.
- Product files: `apps/web/components/TerminalShell.tsx`, `TerminalShell.test.tsx`, and `apps/web/app/globals.css`.
- Implementation: when a private connection reaches error state with `SESSION_OPEN_FAILED`, the UI now presents an accessible alert explaining that a new PowerShell session could not open and asks the user to close an earlier Terminus tab or disconnect a session if eight are active, then retry. Other connection failures retain their existing behavior.
- Commands/evidence:
  - Focused `vitest run components/TerminalShell.test.tsx`: PASS (8/8).
  - Full `vitest run`: PASS (7 files, 36/36 tests).
  - `tsc --noEmit`: PASS.
  - `eslint .`: PASS.
  - `npm run build`: PASS; Next.js 16.3.3 production static build completed.
  - `git diff --check` and product `git show --check`: PASS.
- Security/operations: no endpoint, authentication, certificate, Origin, credential, Tailscale, or deployment behavior changed. No production deployment was performed.
- Live-browser limitation: this product commit has not been integrated or deployed, so the new ninth-tab alert has not yet been exercised in production Chrome. The prior S02-002 production terminal flow remains unchanged until authorized integration/deployment.
- Independent reviewer: pending; do not mark this task `done` or `verified` until maker-independent review is recorded.
- Product/task commit: `edd2823bfae4280eb2a4b038c8f5c35d75b28d8d`.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.

## S02-004 live refresh follow-up (2026-08-27)

- State: owner implementation and live production validation complete; independent review remains pending.
- Product files: `apps/web/components/TerminalShell.tsx` and `apps/web/components/TerminalShell.test.tsx`.
- Root cause: a reload first emitted `visibilitychange(hidden)`, which immediately detached the session. Page teardown then discarded the memory-only resume grant, leaving that detached session to occupy capacity until expiry. At the eight-session limit, an immediate reload/reconnect was therefore rejected.
- Implementation: delay background detach by 100 ms and cancel it on `pagehide`. Real background tabs still detach, while reload/close lets WebSocket teardown release the server session immediately. The resume grant remains memory-only; no authentication, credential-storage, endpoint, or protocol behavior was weakened.
- Commands/evidence:
  - `npm test`: PASS (7 files, 37/37 tests), including page-teardown coverage.
  - `npm run typecheck`: PASS.
  - `npm run lint`: PASS.
  - `npm run build`: PASS; Next.js 16.3.3 production static build completed.
  - `git diff --check`: PASS before commit.
  - Vercel production deployment `dpl_GZXfaPdbHgoiVH3MgtRRnCSZDhnE` reached `READY` and was aliased to `https://terminus-web.vercel.app`; the production response returned HTTP 200 with the expected private WebSocket CSP.
  - Live Chrome opened eight independent PowerShell sessions, rejected a ninth with `SESSION_OPEN_FAILED`, recovered a released slot, and resized the recovered terminal from 134 columns to 83 and back.
  - At the eight-session limit, reloading the recovered tab immediately reduced direct PowerShell children from eight to seven; reconnect succeeded and restored exactly eight unique children. The reconnected terminal resized successfully.
  - Disconnecting all controlled tabs reduced direct PowerShell children to zero. One intentional verified session was then reopened and marked deliverable in Chrome.
  - Agent PID 16788 remained bound only to `127.0.0.1:8443`; Tailscale reported the 443 forward as `tailnet only`, including from `tailscale funnel status`.
- Privacy evidence: no terminal plaintext, command text, clipboard data, secrets, reusable pairing material, or private keys were recorded.
- Independent reviewer: pending; do not mark this task `done` or `verified` until maker-independent review is recorded.
- Product/task commit: `cae2ded7adeeefa9e5cd97e3561cf5bfd9d0570f`.
- Handoff commit: resolve from branch HEAD after this status-only handoff commit.
