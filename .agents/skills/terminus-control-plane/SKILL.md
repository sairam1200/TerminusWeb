---
name: terminus-control-plane
description: Design and build the Terminus metadata-only control plane within Session 04 ownership. Use for tenancy, RBAC, quota leases, subscription state, audit metadata, and database invariants; never terminal relaying.
---

# Terminus Control Plane

Read the repository `AGENTS.md` and follow its required read order. Then read [the Session 04 brief](../../../agents/session-04-control-plane.md), ownership map, tasks, facts, and Session 04 status.

Edit only `services/control-plane/**`, `infrastructure/database/**`, and the Session 04 status. Keep terminal streams out of the service. Make tenant scope and authorization invariants executable in tests before adding handlers. Use one migration history owner and isolated test databases.

Do not activate commercial behavior on Vercel Hobby or deploy a service without explicit authorization.
