# Session 01 request to Session 03: authorized private host wiring

- Source: Session 01 / `session/01-architecture`
- Target: Session 03 / `session/03-windows-agent`
- Task: `S03-004` (new queue task; currently blocked)
- Authoritative queue at request creation: `8db4bb58bd4a6c274f573683db4496865e0d1cb6`
- Exact S03-003 product dependency: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Exact S03-002 product dependency: `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`

## Request

When Session 01 records the required narrow user authorization and the web
owner supplies an exact HTTPS Preview origin, implement only the consumer
wiring needed to run the completed integration host locally. Use externally
provided paths for the already trusted server certificate/key and client-CA
bundle; do not commit, print, or transmit private keys, PFX passwords,
pairing codes, or credential material.

The task must prove, on the recorded non-elevated Windows identity:

- protected credential storage and safe reset/revocation;
- the exact Origin and `/terminal` path;
- certificate hostname/SAN, Server Authentication, trusted-chain result, and
  client-CA/client-leaf identity without exposing secret bytes;
- mandatory local approval and private-device resolution;
- TLS 1.3 on a listener bound to loopback only, with bounded lifecycle and
  `/healthz`/reset controls;
- no LAN/public listener and secret-safe logs; and
- an endpoint-ready response containing only the non-secret endpoint, exact
  Origin, port/listener scope, evidence commands, and cleanup result.

Do not configure Tailscale, Serve, Funnel, DNS, firewall policy, deployment, or
public exposure. Wait for Session 05's read-only transport decision before
claiming a publishable path. Respond in an immutable target-owned response
file and include the exact product and status-only handoff SHAs.
