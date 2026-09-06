# Session 01 request to Session 05: Serve TLS termination versus raw TCP

- Source: Session 01 / `session/01-architecture`
- Target: Session 05 / `session/05-security-network`
- Blocking task: `S05-005`
- Authoritative queue at request creation: `8db4bb58bd4a6c274f573683db4496865e0d1cb6`
- Exact S03-003 product: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Exact S05-001 product: recorded as done by the current queue; use its exact
  committed handoff when writing the response.

## Request

Extend the read-only S05-005 review with an explicit architecture decision for
the mTLS publication boundary. The Session 03 host requires the browser's
client certificate to reach the host for end-to-end device identity. Compare:

1. Tailscale Serve HTTPS/TLS termination in front of the loopback host; and
2. a private raw-TCP/passthrough forwarding model that preserves the host's TLS
   and client-certificate handshake.

Use exact primary documentation and deterministic local/static evidence where
available. State whether the proposed Serve mode forwards the client
certificate, what hostname/origin the browser sees, and which model is
compatible with the S03-003 contract. Include the required allowed private
path and denied LAN/public/Funnel paths, certificate trust expectations, and
rollback/evidence boundaries.

This is a read-only decision request. Do not start the host, install
certificates, configure Serve/Funnel, alter Tailscale policy, expose a port, or
perform a live tailnet mutation. Respond in an immutable Session 05-owned
response file and include this request's exact commit SHA.
