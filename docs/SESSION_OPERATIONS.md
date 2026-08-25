# Six-Session Operating Model

Run each main session in a separate Git branch and worktree. The repository can support six independent user-launched sessions even when an individual agent runtime has a smaller internal concurrency limit.

## Launch prompt pattern

Use the exact brief for the session. Example:

```text
Read AGENTS.md and agents/session-02-web.md completely. Use the terminus-web skill if it is discoverable. Work only on tasks assigned to Session 02 and only inside its owned paths. Begin with the first unblocked task in coordination/tasks.yaml. Update coordination/status/session-02.md with evidence before stopping. Do not merge, deploy, or edit shared contracts.
```

## Parallelism inside one session

When a session can use multiple agents, divide them by outcome and file ownership:

- Maker: implements the smallest scoped change.
- Test author: writes independent acceptance/failure tests in files explicitly delegated by the session owner.
- Reviewer: read-only review against the contract and Definition of Done.

Do not assign two makers to the same component or file. Parallel duplication usually increases merge conflict and correlated mistakes instead of speed.

## Initial parallel start

After Git, the reviewed base commit, and six worktrees exist, the six initial ready tasks (`S01-001`, `S02-001`, `S03-001`, `S04-001`, `S05-001`, and `S06-001`) may run in parallel. Only the protocol- or implementation-dependent follow-up tasks wait.

## Task-state transitions

- `coordination/tasks.yaml` is owned by Session 01 as queue coordinator.
- A task owner records start, evidence, and task commit SHA in its own status file.
- Session 01 changes `ready` to `in_progress` after seeing the start record, changes it to `review` after a committed handoff, and changes it to `verified` or `done` only from Session 06 or the named independent review evidence.
- A blocked task becomes `ready` only when every listed dependency is `done` or `verified`, as appropriate, and Session 01 records that transition.
- Other sessions never edit the queue directly.

Reading a dependency means reading its task entry, owner status, produced contract/artifact, and exact task commit SHA. A task title or another agent's summary is not sufficient dependency evidence.

## Request lifecycle

- The source session creates an immutable `from-SS-to-TT-id.request.md` file and owns it permanently.
- The target session responds in a separate `from-TT-to-SS-id.response.md` file that it owns permanently.
- Revisions create a new numbered request/response pair. No ownership transfer or shared editing occurs.

## Integration cadence

1. Session 01 publishes or updates a contract version.
2. Sessions 02-05 implement only unblocked tasks.
3. Each session records evidence in its own status file.
4. Session 06 verifies exact task commits and produces a pass/fail report.
5. Session 01 prepares an integration manifest containing exact verified SHAs and merge order.
6. The user explicitly authorizes integration; Session 01 creates the integration candidate without rewriting another owner's code.
7. Session 06 independently verifies the integrated candidate.
8. The user authorizes any final merge, push, deployment, live network change, or commercial activation separately.

## Worktree preparation after Git is initialized

Create worktrees from a reviewed common base commit. Use explicit paths appropriate to the machine; do not point two sessions at the same directory.

```powershell
git worktree add ..\terminus-s01 -b session/01-architecture
git worktree add ..\terminus-s02 -b session/02-web
git worktree add ..\terminus-s03 -b session/03-windows-agent
git worktree add ..\terminus-s04 -b session/04-control-plane
git worktree add ..\terminus-s05 -b session/05-security-network
git worktree add ..\terminus-s06 -b session/06-verification-release
```

These commands are instructions only. Run them after the repository and base commit exist.
