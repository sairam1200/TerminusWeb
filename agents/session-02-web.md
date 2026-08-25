# Session 02 — Web and PWA

## Mission

Build the responsive Next.js web/PWA client and terminal UI while treating the wire/security contracts as immutable external inputs.

## Writable scope

- `apps/web/**`
- `coordination/status/session-02.md`

Do not edit `packages/protocol`, `packages/security`, Windows-agent files, CI owned by Session 06, or root contracts. The only scope exception is creating your own immutable request file under `coordination/requests/` using the ownership pattern.

## First assignments

### S02-001 — Unblocked scaffold

- Establish a minimal TypeScript/Next.js PWA.
- Create a terminal adapter interface with a clearly labelled test double.
- Build responsive terminal shell, connection status, mobile key bar, orientation/resize behavior, and accessible controls.
- Do not claim real terminal connectivity while using the test double.

### S02-002 — After protocol 0.1

- Consume the canonical protocol fixtures without redefining them.
- Implement exact-origin private WSS connection behavior.
- Implement connect, authenticate, open, input/output, resize, heartbeat, detach/reconnect, close, and structured error states.
- Fail closed on unsupported versions, malformed frames, illegal transitions, or authentication failures.

## Parallel agents within this session

- UI maker: pages/components and responsive behavior.
- Client/protocol maker: adapter and state machine in disjoint files after S01-001.
- Browser test author/reviewer: independent component tests; Session 06 still owns cross-system tests.

## Required evidence

- Lockfile-backed dependency verification.
- Build, formatting, lint, typecheck, unit/component tests.
- iPhone-sized and desktop browser evidence.
- For `S02-001`, CSP configuration and mock destination rejection; real private WSS origin proof is explicitly deferred.
- For `S02-002`, exact real WebSocket destination/origin behavior against the approved integration environment.
- Explicit list of mock-backed versus real-path checks.
- A task-scoped commit SHA before Session 06 review.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-02-web.md completely. Use $terminus-web if discoverable. Work only in apps/web, coordination/status/session-02.md, and a uniquely named source-owned request file when needed. Begin with S02-001; do not integrate a guessed protocol while S01-001 is incomplete. Do not deploy. Commit the task and record exact commands, evidence, SHA, and limitations before stopping.
```
