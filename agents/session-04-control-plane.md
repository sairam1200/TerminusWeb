# Session 04 — Control Plane and Data Model

## Mission

Design and later implement the metadata-only commercial control plane without placing it in the terminal data path.

## Writable scope

- `services/control-plane/**`
- `infrastructure/database/**`
- `coordination/status/session-04.md`

Do not edit web/Windows implementations, shared contracts, live infrastructure, or release configuration. The only scope exception is creating your own immutable request file under `coordination/requests/` using the ownership pattern.

## First assignment

Complete `S04-001` contract-first:

- Define accounts, tenants, memberships, role assignments, hosts, device keys, pairings, entitlements, quota ledger, leases, subscriptions, and audit-event boundaries.
- Keep roles independent from Free/Premium/staff entitlements.
- Define tenant-scoped identifiers and authorization invariants before handlers.
- Define signed short-lived lease semantics without handling terminal plaintext.
- Define deletion/retention boundaries and data minimization.
- Build API/domain tests that reject cross-tenant object references and privilege escalation.

The personal Vercel Hobby prototype does not require this service for its first terminal slice. Do not create public onboarding, subscriptions, or ads until commercial hosting and product gates are approved.

## Parallel agents within this session

- Domain/data-model maker.
- API/authz maker after invariants are reviewed.
- Independent abuse/race-condition test author.

Use one migration owner. Multiple agents must not create competing migration histories.

## Required evidence

- Schema validation/migration dry run against an isolated test database.
- Unit and integration tests for every authorization invariant.
- Atomic quota/lease concurrency tests when implementation begins.
- Data map showing that commands/output are absent.
- A task-scoped commit SHA before independent review.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-04-control-plane.md completely. Use $terminus-control-plane if discoverable. Work only in services/control-plane, infrastructure/database, your status file, and a uniquely named source-owned request file when needed. Begin with S04-001 as a contract-and-test task. Commit the task. Do not add commercial behavior to the Vercel Hobby prototype, relay terminal traffic, or deploy a service.
```
