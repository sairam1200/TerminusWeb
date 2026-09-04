# TerminusWeb
A private, secure web terminal for accessing your Windows PC from any browser through Tailscale, with a Next.js PWA,   direct encrypted WebSocket connections, and a least-privileged ConPTY agent.

## Notes

- The project now tracks `main` as the baseline for the integrated build.
- Local helper folders (for example `rag/`, `scripts/`, and `.worktrees/`) are expected to remain untracked in most working environments.

## Connect locally and privately

Terminus now supports two named connect modes:

1. **Local mode** (same machine, loopback)
2. **Private mode** (approved private path / public DNS over Tailscale)

Environment variables:

- `NEXT_PUBLIC_TERMINUS_LOCAL_WSS_ENDPOINT` (for local mode WSS endpoint, e.g. `wss://127.0.0.1:4176/terminal`)
- `NEXT_PUBLIC_TERMINUS_LOCAL_WEB_ORIGIN` (exact expected local page origin, e.g. `http://127.0.0.1:4176`)
- `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT` (for private mode WSS endpoint)
- `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` (exact expected browser origin for private mode)
- `NEXT_PUBLIC_TERMINUS_CONNECT_MODE` (optional default mode: `local` or `private`)

Mode behavior:

- Local mode accepts only loopback endpoints and loopback web origins.
- Private mode accepts non-loopback WSS endpoints and requires exact `Origin` match.
- Switching modes is a local UI selection when both profiles are available.
- The selected mode is persisted in browser storage for restart (`localStorage`) as non-secret config
  (`mode`, `endpoint`, and `expectedWebOrigin`).

To run locally:

1. Run the Windows integration host on loopback and expose local websocket endpoint (`wss://127.0.0.1:4176/terminal`).
2. Set the local mode variables to exact loopback values above.

To run private mode:

1. Publish the loopback origin privately through your approved Tailscale path.
2. Set the private mode variables to that `wss://` private address and the browser origin.

Security and persistence notes:

- No terminal/session secrets are persisted in local storage.
- Secrets are held in browser-indexed credential storage and protocol frame exchange.
- The UI does not silently fall back between private and local mode.
