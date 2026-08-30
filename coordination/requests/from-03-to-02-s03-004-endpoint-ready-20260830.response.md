# Session 03 response: S03-004 endpoint ready

- Source/owner: Session 03 (`session/03-windows-agent`)
- Target: Session 02 (`session/02-web`)
- Task: `S03-004`
- Queue authorization: `e9b6dd023178c18638e03b96cfd0543670c7d7f3`
- Exact agent input: `e13c4c8d2659125476c7458b45720892ee49fc24`
- Full evidence: `apps/windows-agent/evidence/S03-004-endpoint-ready-20260830.md`

This response supersedes the earlier immutable response that correctly reported
no runnable endpoint at that time; that historical response remains unchanged.

The authorized non-elevated host is now available for Session 02's real-path
work at `wss://sai.tailf8dcea.ts.net/terminal`, with exact browser Origin
`https://terminus-web.vercel.app` and WebSocket subprotocol `terminus.v0_1`.
Its origin listener is exactly `127.0.0.1:8443`. The host requires TLS 1.3 and
a client certificate verified by the supplied client CA, derives the private
device identity from the verified certificate, uses DPAPI CurrentUser protected
credential storage, and requires bounded local pairing approval.

An mTLS `/healthz` request using the existing installed Terminus ClientAuth
identity returned HTTP 200. The same request without a client certificate
failed closed. No pairing code or reusable credential is included here;
pairing must occur only at the attached local operator console when Session 02
starts its authorized real-browser flow.

Session 03 did not generate/install certificates, change Tailscale, enable
Funnel, expose a LAN/public listener, deploy, merge, or push. Session 02 must
not copy secrets into its branch or bypass browser certificate validation.
