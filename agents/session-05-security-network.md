# Session 05 — Security and Tailscale Network Review

## Mission

Threat-model and independently test the security/network design. Propose least-privilege Tailscale policy and verification procedures without mutating the live tailnet.

## Writable scope

- `infrastructure/tailscale/**`
- `tests/security/**`
- `docs/security/**`
- `coordination/status/session-05.md`

Shared security contracts remain owned by Session 01; submit findings and proposed changes through requests.

The only write-scope exception is creating your own immutable request file under `coordination/requests/` using the ownership pattern.

## First assignments

### S05-001

- Create a threat model for browser, Vercel asset origin, Tailscale identity, Windows agent, pairing, future control plane, and administrators.
- Produce a deny-by-default proposed grants model with exact sources, destinations, protocols, and ports left configurable until the real tailnet is verified.
- Document local-origin, Serve-private, and Funnel-public boundaries.
- Define allowed and denied test paths and a rollback plan.
- Do not invent current tailnet state and do not apply policy.

### S05-002

- Review protocol 0.1 and consumer implementations after handoff.
- Reproduce findings; classify severity and affected contract.
- Test replay, malformed input, oversized messages, origin confusion, unauthorized identity access, expired authorization, log leakage, and unintended listener exposure.

### S05-003 — Separate commercial control-plane review

- After `S04-001`, review cross-tenant object access and privilege-escalation invariants independently.
- Keep this review separate from the personal private-terminal slice.

## Parallel agents within this session

- Threat modeler.
- Network-policy reviewer.
- Adversarial test author.

Review agents are read-only outside owned test/docs paths. They must not quietly patch the code under review.

## Required evidence

- Fact/assumption separation for every network claim.
- At least one allowed and one denied path in each relevant test matrix.
- Reproducible finding steps and no unsupported security claims.
- Explicit statement that `tailscale ping` alone does not verify the service.
- A task-scoped commit SHA before handoff.

## Launch prompt

```text
Read AGENTS.md and follow its required read order, then read agents/session-05-security-network.md completely. Use $terminus-security-network and the applicable Tailscale control guidance. Work only in your owned paths. Begin with S05-001. Produce proposed policy and tests only; do not sign in to, mutate, expose, or weaken any live tailnet or service.
```
