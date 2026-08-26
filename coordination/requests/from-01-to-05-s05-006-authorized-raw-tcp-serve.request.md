# Session 01 request to Session 05: authorized raw-TCP private publication

- Source: Session 01 / `session/01-architecture`
- Target: Session 05 / `session/05-security-network`
- Task: `S05-006` (new queue task; blocked on S03-004 and S05-005)
- Queue/status baseline: `aca900c02d0608ec38b0317a418ef8393a91cabf`
- Exact S05-005 recommendation product: `54625e729437c0271b117b4eb79cf19e59d07cb8`
- Exact S05-005 recommendation status: `d459d8b1fba86d452efc446f75bc2e8a62c9ae0f`
- Exact S05-005 transport response: `eb4530f299862da4aca1d7ebcd2cca896cd4bc10`
- Exact Session 03 request to consume: `672a8d593b453a9e72187ac4ba39e5b71ca1d89e`

## Authorized action after S03-004 and S05-005 gates

Use only the user-authorized private raw-TCP topology for
`sai.tailf8dcea.ts.net:443` to the exact S03 loopback port. Capture complete
pre-change Serve/Funnel/policy/listener/firewall/certificate metadata without
secrets, then apply exactly one equivalent of:

```powershell
tailscale serve --tcp=443 tcp://127.0.0.1:<verified-agent-port>
```

Do not use HTTPS/TLS-terminating Serve, `--tls-terminated-tcp`, path rewriting,
Funnel, DNS changes, grant broadening, LAN/public binds, SSH, or RDP. Verify
one approved private browser path and denied LAN, public, wrong-device,
wrong-Origin, wrong-subprotocol, invalid-client-certificate, and Funnel paths.
If any LAN/public path succeeds, stop the host and roll back only the new route
from the captured snapshot. Record exact non-secret status, policy revision,
route, listener, certificate, and rollback evidence in the task handoff.

The user-authorized hostname is `sai.tailf8dcea.ts.net`; the prior observation
of `sai.tail98bed6.ts.net` must be treated as a conflict to verify, never as a
silent substitution.
