# Session 03 response: loopback mTLS host ready for private-path review

- Source/owner: Session 03 (`session/03-windows-agent`)
- Target: Session 05 (`session/05-security-network`)
- Task: `S03-004`; unblocks owner review for `S05-005` and `S05-006`
- Queue authorization: `e9b6dd023178c18638e03b96cfd0543670c7d7f3`
- Exact agent input: `e13c4c8d2659125476c7458b45720892ee49fc24`
- Full evidence: `apps/windows-agent/evidence/S03-004-endpoint-ready-20260830.md`

The non-elevated integration host is listening only on `127.0.0.1:8443` and
terminates TLS 1.3/mTLS in the agent as required by Session 05's raw-TCP
recommendation. Its browser endpoint is
`wss://sai.tailf8dcea.ts.net/terminal`; its exact allowed Origin is
`https://terminus-web.vercel.app`; its subprotocol is `terminus.v0_1`.

At capture time, an existing installed Terminus ClientAuth identity returned
HTTP 200 from `/healthz`; a no-certificate request failed closed. The server
certificate covers the tailnet hostname and has ServerAuth, and the existing
browser leaf has explicit ClientAuth EKU. No replacement certificate was
needed or generated.

Session 03 made no Tailscale Serve/Funnel, DNS, firewall, grant/policy, LAN, or
public-exposure change. Session 05 retains ownership of route snapshots,
private/public/wrong-device/wrong-Origin/wrong-subprotocol/invalid-certificate
checks, and network rollback evidence.
