---
name: terminus-security-network
description: Threat-model and independently test Terminus security and Tailscale-private networking within Session 05 ownership. Use for proposed grants, allowed/denied matrices, adversarial tests, and security reviews; not live mutations.
---

# Terminus Security and Network

Read the repository `AGENTS.md` and follow its required read order. Then read [the Session 05 brief](../../../agents/session-05-security-network.md), ownership, tasks, facts, and Session 05 status. When Tailscale policy or connectivity is involved, also load the applicable Tailscale control skill and its required references.

Edit only Session 05 owned paths. Separate verified state from assumptions, keep origins on loopback, prefer deny-by-default private access, and test at least one expected allowed and denied flow. `tailscale ping` proves only a tailnet path, not the service.

Do not modify live tailnet state, enable Funnel, expose public SSH/terminal ports, or patch code under review.
