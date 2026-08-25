# Terminus Collaboration Rules

This repository is a contract-first workspace for a private web terminal that loads from Vercel and connects directly to a user-owned Windows PC over Tailscale.

## Required read order

1. Read this file completely.
2. Read `docs/ARCHITECTURE.md`, `docs/SHARED_CONTRACTS.md`, and `docs/DEFINITION_OF_DONE.md`.
3. Read the session brief assigned to you under `agents/`.
4. Read `coordination/ownership.yaml`, `coordination/tasks.yaml`, and every dependency named by your task. For a dependency, read its queue entry, owner status, produced contract/artifact, and recorded commit SHA.
5. Read your session status file before changing anything.

## Non-negotiable product boundaries

- Vercel serves the web/PWA assets. Terminal input and output must not be proxied through or stored by Vercel or the future control plane.
- The Windows terminal service remains private. Keep its origin on loopback and expose it only through an explicitly approved Tailscale-private path.
- Tailscale provides connectivity and network policy; it does not replace application pairing, authentication, authorization, or session expiry.
- Do not enable Tailscale Funnel or expose raw terminal, SSH, RDP, or agent ports to the public internet.
- Platform administration must not create a universal terminal-decryption key or silent customer backdoor.
- Roles and billing plans are separate concepts. An Owner role does not automatically imply Premium terminal entitlement.
- The Vercel Hobby deployment is a personal, non-commercial prototype. Do not add paid subscriptions, advertisements, or public commercial onboarding while it remains on Hobby.
- Never log terminal plaintext, commands, clipboard contents, secrets, private keys, auth tokens, or reusable pairing material.

## Evidence and anti-hallucination rules

- Do not invent APIs, package names, platform capabilities, test results, or live state.
- Before using an external API or dependency, verify it from the installed version, lockfile, type definitions, or primary official documentation. Record the source in the handoff.
- Distinguish facts, assumptions, proposals, and unresolved questions. Put unresolved contract decisions in `coordination/requests/`.
- A feature is not complete because code exists or an agent says it works. Completion requires the deterministic checks in `docs/DEFINITION_OF_DONE.md` and the session brief.
- Report exact commands and outcomes. Never claim a test, build, deployment, browser flow, or network path was verified when it was not run.
- Use mocks only at explicit contract boundaries. Label mock-backed results and do not present them as end-to-end proof.
- When primary sources conflict with repository contracts, stop and file a decision request rather than silently choosing one.

## Parallel work and ownership

- One session owns each writable path. Ownership is defined in `coordination/ownership.yaml`.
- Never edit another session's paths directly, even for a small fix. File a source-owned immutable request under `coordination/requests/` or ask the owning session.
- Shared contract files are owned by Session 01. Other sessions may propose changes but must not make unilateral protocol or security-contract edits.
- Each session uses its own Git branch and preferably its own Git worktree. Do not run multiple writing agents against one working tree.
- Within a session, parallel agents must own disjoint files. Use a maker, an independent test author, and a reviewer instead of multiple agents implementing the same file.
- No agent may merge, push, deploy, change DNS, change Tailscale policy, enable public exposure, create billing products, or mutate a live control plane without the user's explicit authorization.

## Branch and handoff rules

- Branch names: `session/01-architecture`, `session/02-web`, `session/03-windows-agent`, `session/04-control-plane`, `session/05-security-network`, and `session/06-verification-release`.
- Keep commits scoped to one task ID from `coordination/tasks.yaml`. A task must have an immutable commit SHA before independent verification; the session owner creates that task commit.
- Update only your own `coordination/status/session-XX.md` with current task, files changed, commands run, evidence, assumptions, blockers, and the task commit SHA.
- Session 01 owns task-queue transitions. A session begins by marking its own status `in_progress`; Session 01 updates `coordination/tasks.yaml` to `in_progress`, `review`, `verified`, `done`, or newly `ready` only from recorded dependency and verifier evidence.
- Integration occurs through explicit integration tasks. Session 01 first prepares a manifest of exact verified SHAs. Git merge/cherry-pick into an integration branch requires the user's explicit authorization, and Session 06 then verifies the integrated candidate.
- Never weaken or delete a test merely to make a gate pass without an approved contract change.

## Safe stopping rule

After three failed attempts caused by the same underlying condition, stop that task, preserve evidence, update the session status, and file a focused blocker or contract request. Do not loop indefinitely or broaden scope to force progress.
