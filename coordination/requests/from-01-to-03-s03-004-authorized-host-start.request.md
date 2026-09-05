# Session 01 request to Session 03: authorized private host start

- Source: Session 01 / `session/01-architecture`
- Target: Session 03 / `session/03-windows-agent`
- Task: `S03-004` (queue-gated; remains blocked until the exact Preview Origin is committed)
- Queue/status baseline: `aca900c02d0608ec38b0317a418ef8393a91cabf`
- Exact S03-003 product: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Exact S03-003 handoff: `662e376094c631890dd22d23391ff6a7e62d8a30`
- User-authorized server hostname: `sai.tailf8dcea.ts.net`

## Authorized action after the Preview Origin is ready

Run the reviewed integration host non-elevated on one verified unused high
loopback port, using these out-of-band inputs (never commit or print their
contents):

```text
cert:      C:\Users\saira\AppData\Local\Terminus\private-certs\server.crt
key:       C:\Users\saira\AppData\Local\Terminus\private-certs\server.key
client-ca: C:\Users\saira\AppData\Local\Terminus\private-certs\client-ca.pem
server:    sai.tailf8dcea.ts.net
origin:    <exact committed Vercel Preview origin>
listen:    127.0.0.1:<verified-unused-high-port>
```

Regenerate or replace the browser leaf first if its metadata lacks explicit
Client Authentication EKU `1.3.6.1.5.5.7.3.2`; do not expose the PFX password
or private key. The handoff must record only non-secret certificate metadata,
the exact Origin, loopback port, `/healthz` result, protected-store lifecycle,
listener scope, cleanup, and secret-safe logs. Produce the immutable
endpoint-ready response required by `S02-002` only after successful host
startup and cleanup. Do not configure Tailscale, Serve, Funnel, DNS, firewall
policy, or public/LAN exposure.
