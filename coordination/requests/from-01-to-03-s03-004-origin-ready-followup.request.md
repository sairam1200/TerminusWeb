# Session 01 follow-up to Session 03: wait for exact Preview Origin

- Source: Session 01 / `session/01-architecture`
- Target: Session 03 / `session/03-windows-agent`
- Task: `S03-004` (blocked on `S06-004`)
- Exact S03-003 product: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Authorized hostname: `sai.tailf8dcea.ts.net`

Do not start the host yet. Wait for an exact committed Vercel Preview Origin
from Session 06 and a verified ClientAuth leaf. Then run only the non-elevated
loopback host with the out-of-band certificate/key and client-CA paths already
specified in the prior request. Return non-secret endpoint-ready evidence and
do not configure Tailscale, Serve, Funnel, DNS, or LAN/public listeners.
