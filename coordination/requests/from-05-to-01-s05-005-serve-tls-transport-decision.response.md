# Session 05 response: S05-005 Serve transport decision

- Responds to request commit: `e1c5cb7cbcff2a271c73d5dcf452d01a0ca39d57`
- Blocking task: `S05-005`
- Exact S03-003 product reviewed: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Exact S05-001 policy product: `ccc6a11c97b26223e8aa8d7d9c0b4fda5eba9a3e`

## Decision

Use private raw TCP Serve forwarding, not HTTPS/TLS-terminating Serve. The S03-003 host sets `tls.Config.ClientAuth = tls.RequireAndVerifyClientCert`; a layer-7 HTTPS Serve endpoint terminates the browser TLS session at Tailscale and therefore cannot forward the browser's client-certificate handshake to the loopback host. Raw TCP forwarding preserves the browser-to-host TLS 1.3 and mTLS exchange. Tailscale documents `--tcp` as a raw TCP forwarder and distinguishes it from `--tls-terminated-tcp` and HTTPS Serve: <https://tailscale.com/docs/reference/tailscale-cli/serve> and <https://tailscale.com/docs/features/tailscale-services>.

Proposed topology (not configured):

```text
browser (Origin = exact Vercel Preview Origin, client cert)
  -> https://sai.tailf8dcea.ts.net:443 (private TCP Serve)
  -> tcp://127.0.0.1:<verified-agent-port>
  -> S03-003 TLS 1.3 host, /terminal, terminus.v0_1
```

Raw TCP has no path rewriting; the browser sees `sai.tailf8dcea.ts.net` and sends `/terminal`. The host continues exact Origin, subprotocol, pairing, device-certificate, authorization, expiry, replay, and session checks. The exact Vercel Preview Origin remains unresolved and must be supplied verbatim before use.

## Access-control evidence

- S05-001’s committed proposal grants only `group:terminus-terminal-operators` → `tag:terminus-windows-agent` over TCP to the unresolved Serve HTTPS port. It explicitly denies SSH/22, RDP/3389, UDP, ICMP, and an unlisted identity; no wildcard, LAN, public, Funnel, subnet-route, or exit-node rule is present.
- The reviewed S03-003 host rejects wildcard, LAN, tailnet-interface, plaintext, and public listener binds and requires an explicit loopback listener. Its only application route is `/terminal`; health is non-secret `/healthz`.
- Read-only local Tailscale inspection reported `sai.tail98bed6.ts.net`, MagicDNS enabled, and both `tailscale serve status` and `tailscale funnel status` as `No serve config`. This is environment evidence only, not proof of an approved route.
- The intended allowed path is an approved operator device over the private tailnet to TCP Serve, then loopback host TLS/mTLS and application pairing. Denied paths are LAN/public direct listener, unlisted tailnet identity, wrong device certificate, wrong Origin/subprotocol, and Funnel/public internet.

## Certificate and rollback boundaries

The server certificate must be trusted by the browser/OS, include `sai.tailf8dcea.ts.net` in SAN, and carry ServerAuth EKU. The browser certificate must chain to the supplied client CA and carry explicit ClientAuth EKU; the previously observed `CN=localhost` self-signed server certificate and client certificate without explicit ClientAuth are not acceptable. No certificate or key was changed.

Before any separately authorized configuration, capture complete Serve/Funnel status, policy revision, listener/firewall state, certificate metadata/expiry, and route configuration without secrets. Apply only raw TCP Serve. Validate one allowed and all denied paths, then roll back the new route with the captured configuration (the operator may use `tailscale serve reset` only for the newly authorized route). Funnel must remain disabled.

No host, certificate, DNS, listener, Tailscale policy, Serve, Funnel, or endpoint mutation was performed for this response.
