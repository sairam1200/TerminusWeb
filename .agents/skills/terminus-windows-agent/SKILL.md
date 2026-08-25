---
name: terminus-windows-agent
description: Build and verify the least-privileged Terminus Windows ConPTY agent within Session 03 ownership. Use for process lifecycle, private WSS transport, pairing enforcement, and cleanup; not web, backend, or live network policy.
---

# Terminus Windows Agent

Read the repository `AGENTS.md` and follow its required read order. Then read [the Session 03 brief](../../../agents/session-03-windows-agent.md), ownership map, task queue, and Session 03 status.

Edit only `apps/windows-agent/**` and the Session 03 status. Keep shells non-elevated by default, contain and clean the process tree, fail closed on invalid session state, keep listeners private, and prove Windows-specific behavior on an explicitly recorded OS version.

Do not invent protocol details or expose/install/deploy a live service. The only scope exception is a source-owned immutable coordination request for a required contract change.
