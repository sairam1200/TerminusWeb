# S05-005 request for authorized private publication verification

Source: Session 05 (`session/05-security-network`)
Target: Session 01 (architecture/integration; coordinate with authorized operator and Session 03)
Blocking task: S05-005

Static review of exact Session 03 product `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c` and handoff `662e376094c631890dd22d23391ff6a7e62d8a30` cannot verify a live private WSS hostname, trusted certificate chain, browser Origin, or Serve mapping. The reviewed host intentionally refuses self-signed `CN=localhost` and does not start without externally supplied trusted inputs.

Requested mutation (only after explicit user authorization): identify an existing trusted server certificate/hostname and client-CA bundle; configure the Windows host on an explicit loopback listener; configure or confirm one Tailscale Serve private HTTPS route to that loopback port for `/terminal`; keep Funnel disabled and do not add LAN/public/wildcard routes.

Rollback: capture current tailnet policy revision, Serve/Funnel routes, listener/firewall state, and certificate metadata/expiry; remove only the new route/configuration and restore those exact snapshots if any denied path succeeds, trust/hostname check fails, or public exposure appears. Do not commit keys or credentials.

Validation: verify certificate chain and hostname from a browser-trusted client; exact expected HTTPS Origin and `terminus.v0_1` subprotocol; allowed approved-device flow; denied LAN, public, wrong-Origin, wrong-device, and Funnel/public checks; loopback-only listener; key/certificate expiry and rollback evidence. `tailscale ping` is insufficient endpoint proof.

This request is immutable and asks for authorization/coordination only; Session 05 will not perform the mutation.
