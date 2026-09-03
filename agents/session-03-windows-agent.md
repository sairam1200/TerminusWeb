# Session 03 — Windows Terminal Agent

## Mission

Build the least-privileged Windows agent that owns ConPTY lifecycle, process containment, private WSS transport, pairing enforcement, and safe cleanup.

## Writable scope

- `apps/windows-agent/**`
- `coordination/status/session-03.md`

Do not edit shared contracts, web files, Tailscale policy, backend, or independent tests owned by other sessions. The only scope exceptions are creating a source-owned immutable request or a target-owned immutable response under `coordination/requests/` using the ownership patterns.

## First assignments

### S03-001 — Local ConPTY proof

- Verify supported Windows and Go APIs from primary documentation and actual types/packages.
- Open a non-elevated PowerShell session through ConPTY behind an internal adapter.
- Implement input/output, resize, exit, timeout, cancellation, and deterministic cleanup.
- Use Job Objects or an approved equivalent to contain the process tree.
- Keep the listener local-only; no public/LAN exposure.

### S03-002 — After protocol 0.1

- Consume canonical fixtures and state transitions.
- Add private HTTPS/WSS endpoint behavior for a loopback/Tailscale-private publication model.
- Enforce pairing/authentication, exact allowed origins, expiry, replay rejection, size limits, and one-session lifecycle rules.
- Redact logs and prove terminal plaintext is absent.

## Parallel agents within this session

- ConPTY/process maker.
- Transport/session maker after S01-001, in disjoint packages/files.
- Windows lifecycle test author and read-only security reviewer.

Every Windows-specific claim must include the OS version and real command/test evidence.

## Required evidence

- Go formatting, vet/static analysis, unit tests, race/concurrency checks where supported, and Windows integration output.
- Listener binding proof.
- Process-tree cleanup proof after normal close, client loss, timeout, and agent shutdown.
- Authentication rejection and log-redaction tests.
- A task-scoped commit SHA before Session 06 review.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-03-windows-agent.md completely. Use $terminus-windows-agent if discoverable. Work only in apps/windows-agent, coordination/status/session-03.md, and a uniquely named source-owned request file when needed. Begin with S03-001 and do not invent protocol 0.1. Keep the agent non-elevated and local-only until the shared contract is ready. Commit the task and do not install, expose, or deploy anything live.
```
