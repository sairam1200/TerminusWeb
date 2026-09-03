# Session 01 — Architecture and Integration Lead

## Mission

Own the system contracts and integrate only independently verified work. You are not the default implementer for the web, Windows agent, backend, network policy, or test harness.

## Read first

- Root `AGENTS.md` and all shared documents it names.
- `coordination/facts.md`, `coordination/ownership.yaml`, and `coordination/tasks.yaml`.
- Every open request addressed to Session 01.

## Writable scope

- `packages/protocol/**`
- `packages/security/**`
- `docs/ARCHITECTURE.md`
- `docs/SHARED_CONTRACTS.md`
- `coordination/facts.md`
- `coordination/tasks.yaml`
- `coordination/status/session-01.md`

Root-level integration edits require a reviewed integration task. Do not absorb another session's implementation scope.

`coordination/ownership.yaml` and root governance rules are not ordinary Session 01 scope. Changing them requires a dedicated governance task, Session 06 review, and explicit user authorization.

## First assignment

Complete `S01-001`:

1. Define protocol version 0.1 using a language-neutral schema or fixture format.
2. Define the connection/session state machine and legal transitions.
3. Define payload, sequence, version, timeout, and replay rules.
4. Define pairing/authentication semantics without inventing custom cryptography.
5. Provide canonical positive and negative fixtures for web, Windows, security, and verification consumers.
6. Record unresolved cryptographic choices as explicit blockers rather than filling gaps with guesses.

## Parallel agents within this session

- Contract author: owns protocol schema and fixtures.
- Security contract reviewer: read-only review plus separate security test vectors.
- Integration reviewer: checks consumers after Sessions 02/03 hand off.

Do not allow the author and reviewer to silently edit the same file. Review findings become requests or focused patches approved by the session lead.

## Queue and integration assignments

- Maintain task states from status/verification evidence; never self-certify another session's work.
- Read other sessions through committed branch refs using `docs/SESSION_OPERATIONS.md`; never assume your worktree copy is current.
- `S01-002` produces only an integration manifest of verified SHAs.
- `S01-003` remains blocked until the user explicitly authorizes integration.
- During authorized integration, combine exact approved commits. If a conflict requires implementation edits, return it to the owning session instead of resolving it by changing their code.

## Required evidence

- Schema validation command and result.
- Fixture validation for accepted and rejected cases.
- State-transition coverage.
- Compatibility notes consumed by Sessions 02, 03, and 06.
- Updated Session 01 status with exact limitations.
- A task-scoped commit SHA before verification or queue advancement.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-01-architecture.md completely. Use $terminus-architecture if discoverable. Work only on Session 01 tasks and owned paths. Begin with S01-001. Do not implement frontend, Windows-agent, backend, or live infrastructure. Publish evidence and update coordination/status/session-01.md before stopping.
```
