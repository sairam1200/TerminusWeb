# Session Launch Index

Launch each session from its own Git worktree after the repository has a reviewed base commit.

| Session | Role | Skill | Brief | First task |
|---|---|---|---|---|
| 01 | Architecture/integration | `$terminus-architecture` | `agents/session-01-architecture.md` | `S01-001` |
| 02 | Web/PWA | `$terminus-web` | `agents/session-02-web.md` | `S02-001` |
| 03 | Windows agent | `$terminus-windows-agent` | `agents/session-03-windows-agent.md` | `S03-001` |
| 04 | Control plane | `$terminus-control-plane` | `agents/session-04-control-plane.md` | `S04-001` |
| 05 | Security/network | `$terminus-security-network` | `agents/session-05-security-network.md` | `S05-001` |
| 06 | Verification/release | `$terminus-verification-release` | `agents/session-06-verification-release.md` | `S06-001` |

For each new session, paste the `Launch prompt` from its brief. If project skills are not automatically discovered by the client, instruct the session to read the corresponding `.agents/skills/<name>/SKILL.md` directly.

Do not launch multiple writing sessions in the same checkout. Within one session, additional agents must own disjoint files and should be assigned as maker, test author, and read-only reviewer.
