# S05-005 private publication review

Status: static/read-only review. No tailnet, certificate, DNS, device, Serve, Funnel, or endpoint mutation was performed.

## Exact inputs

- Queue: Session 01 `bfb431a7694152e8d5caf124f58076d78443bd32`; S05-005 ready after S03-003 done.
- Session 03 product: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`.
- Session 03 handoff: `662e376094c631890dd22d23391ff6a7e62d8a30`.
- S05-001 policy proposal: `infrastructure/tailscale/policy.fragment.template.hujson`.

## Verified static design

The host defaults to `127.0.0.1:0`, validates loopback both before and after bind, requires TLS 1.3, a server certificate trusted by the current Windows user and covering `-server-name`, and a verified client certificate for private-device identity. The endpoint serves `/terminal` and accepts one configured exact HTTPS `Origin` and the `terminus.v0_1` subprotocol. Tailscale Serve is an external private publication boundary; the policy proposal grants only TCP to `tag:terminus-windows-agent` and contains no public/LAN/wildcard selector or Funnel attribute.

The intended flow is: browser with approved Tailscale identity → existing private Serve hostname and HTTPS port → loopback agent origin → application pairing/device authentication → `/terminal` WSS. Tailscale reachability alone is not application proof.

## Matrix and evidence classification

| Path/check | Expected result | Evidence |
|---|---|---|
| Loopback origin → private Serve | Allowed only after approved mapping and app auth | Static design; live untested |
| LAN/public direct listener | Denied (no non-loopback bind) | Static source + host tests |
| Wrong Origin/subprotocol | Denied | Exact S03-002 endpoint tests cited by handoff; no live endpoint |
| Wrong device/client certificate | Denied | Static mTLS resolver and host test |
| Funnel/public internet | Disabled/prohibited by proposal | Static policy/docs; live state untested |
| Wildcard/LAN/public listener | Denied before/after bind | Static source + host tests |
| Certificate hostname/trust chain | Must pass system-root verification | Static verifier; no supplied trusted cert, live untested |

Exact private WSS hostname, HTTPS port, path publication, browser-trusted chain, expected browser Origin, Funnel state, key expiry, and rollback snapshot are **unresolved live facts**. The code documents `/terminal`; the hostname/path mapping cannot be claimed because no approved Serve mapping exists. The only known candidate certificate is self-signed `CN=localhost` and is correctly rejected by the host handoff.

Rollback for any future authorized change: capture policy, Serve/Funnel routes, listener/firewall, certificate metadata and expiry; apply the smallest private-only mapping; validate allowed/denied matrix; restore the exact snapshots immediately on any unexpected exposure or failed negative control. Certificate private keys must never enter this repository or logs.

## Boundary conclusion

No existing approved private Serve mapping is evidenced in the reviewed commits. A live operator must supply an already trusted certificate/hostname and approved private mapping. This requires explicit authorization and is recorded in the immutable request accompanying this review.
