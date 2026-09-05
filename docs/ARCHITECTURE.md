# Architecture Baseline

Status: approved planning baseline; implementation details remain contract-gated.

## Personal web prototype

```text
iPhone Safari / installed PWA
    |
    | loads static web assets
    v
Vercel Hobby (personal, non-commercial prototype)

iPhone browser
    |
    | direct authenticated WSS over the private tailnet
    v
Tailscale-private HTTPS/WSS endpoint
    |
    | loopback origin
    v
Windows agent -> ConPTY -> user-owned shell
```

The Vercel request path and the terminal data path are separate. Vercel must not relay terminal frames.

## Future commercial control plane

```text
Web/PWA -------- HTTPS --------> Control plane
  |                                 |-- identity
  |                                 |-- tenants/RBAC
  |                                 |-- host registry
  |                                 |-- quota leases
  |                                 |-- billing state
  |                                 `-- metadata-only audit
  |
  `------ encrypted WSS over Tailscale ------> Windows agent
```

The control plane may authorize a session but cannot decrypt its terminal stream.

## Deployable boundaries

- `apps/web`: Next.js/TypeScript PWA and terminal UI.
- `apps/windows-agent`: Go Windows service/application, ConPTY, private WSS endpoint, pairing, and process containment.
- `services/control-plane`: future Go API for identity, RBAC, leases, billing, and audit metadata.
- `packages/protocol`: source-controlled wire contract shared by implementations.
- `packages/security`: threat model, pairing/session security contract, and test vectors; no private credentials.
- `infrastructure/tailscale`: proposed private policy and verification procedures only; live changes require authorization.
- `tests`: independent browser, integration, protocol, abuse, and security verification.

## First vertical slice

The first integration target is deliberately narrow:

1. Load the PWA from a Vercel preview.
2. Pair one browser with one Windows agent.
3. Connect directly through a Tailscale-private `wss://` endpoint.
4. Open one independent non-elevated PowerShell session per authenticated
   browser tab through ConPTY, without a fixed protocol or application-policy
   limit on the number of concurrent sessions across the agent.
5. Exchange input, output, resize, heartbeat, detach, and close frames.
6. Reconnect after foreground/background or network interruption without exposing a public port.

The agent does not reject `open_session` solely because some numeric count of
other sessions is active or detached. It attempts terminal creation for every
valid request unless shutdown has begun; a genuine adapter, ConPTY, or system
resource failure uses the existing `SESSION_OPEN_FAILED` result and cleans up
any partially created resources. Each accepted tab retains its own connection,
session identifier, ConPTY process, resize state, heartbeat, reconnect state,
and cleanup lifecycle. Protocol 0.1 still carries at most one terminal per
WebSocket and does not multiplex terminals.

Subscriptions, advertising, owners, multi-tenancy, and super-administration are outside this first vertical slice.
