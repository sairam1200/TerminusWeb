# S05-005 live private mTLS publication review

Status: owner review complete against the existing endpoint and route. This is
not Session 06 verification and makes no mobile-browser compatibility claim.

## Exact inputs

- Authoritative queue: `8e87e8f422bc10f77573e41555d6d46d237431ad`;
  S03-004 and S05-001 are `done`, and S05-005 is `ready`.
- Exact S03-004 endpoint-ready product:
  `ce5ac98b8a79abd42fee6083345709c77aaf669c`.
- Exact S03-004 handoff:
  `ec1e6520acfb7775b1ce20da5b83719c6df3d4c4`.
- S05-001 product:
  `ccc6a11c97b26223e8aa8d7d9c0b4fda5eba9a3e`.
- Prior S05-005 raw-TCP recommendation:
  `54625e729437c0271b117b4eb79cf19e59d07cb8`.

The live host and route already existed before this review. Session 05 made no
Tailscale, policy, DNS, Funnel, firewall, listener, process, certificate, or
credential change.

## Decision and verified topology

The earlier raw-TCP decision is confirmed. The agent requires the browser
certificate at its own TLS 1.3 boundary, so a TLS-terminating HTTPS Serve route
would consume the client certificate before it reached the agent. The active
configuration instead forwards TCP byte-for-byte:

```text
approved tailnet client with ClientAuth certificate
  -> sai.tailf8dcea.ts.net:443 (Tailscale CLI: tailnet only)
  -> raw TCP forward
  -> 127.0.0.1:8443 (PID 5384 integration-host)
  -> agent TLS 1.3 / mTLS
  -> /terminal exact Origin + terminus.v0_1
```

Read-only `tailscale serve status --json` returned one `TCPForward` from port
443 to `127.0.0.1:8443`, with no HTTPS termination or path mapping. Both
`tailscale serve status` and `tailscale funnel status` labelled the route
`tailnet only`. `Get-NetTCPConnection` showed PID 5384 listening only on
`127.0.0.1:8443`; direct TCP to the host's Tailscale address and LAN address on
8443 failed, while loopback 8443 and the private Tailscale address on 443
succeeded.

The current Tailscale client is `1.102.3`. The backend was `Running`, self node
`sai.tailf8dcea.ts.net` was online in tailnet `sairamch10@gmail.com`, the node
had no tags, and its key expires on 2027-02-16. The local CLI does not establish
the operator's administrative role, device-approval state, or the complete
additive grants/ACLs; those remain separately classified limitations.

## TLS, certificate, and WSS evidence

The existing Windows CurrentUser certificate identity has subject
`CN=Terminus Test Browser`, issuer `CN=Terminus Test Client CA`, a private key,
validity from 2026-08-26 through 2027-02-26, and an Extended Key Usage extension
containing Client Authentication OID `1.3.6.1.5.5.7.3.2`. No certificate or
private-key bytes, password, or thumbprint are recorded here.

Using that already installed identity, two consecutive Windows certificate-
store requests to `https://sai.tailf8dcea.ts.net/healthz` returned HTTP 200 and
body `ok`. No import, certificate generation, pairing, or local approval was
performed between them. This proves current Windows-store TLS trust, hostname
acceptance, client-CA acceptance, and programmatic identity reuse. It does not
prove Chrome, Firefox, Android, or iPhone selection/reuse UI.

An unrelated time-valid private-key certificate was rejected with a
`WebException`. A request without a client certificate failed closed with curl
exit 56 and HTTP status 000. With the valid installed identity:

- exact Origin `https://terminus-web.vercel.app` plus subprotocol
  `terminus.v0_1` completed a WSS upgrade and negotiated `terminus.v0_1`;
- Origin `https://attacker.invalid` was rejected with HTTP 403;
- subprotocol `other.v1` was rejected with HTTP 426.

No protocol hello, pairing, authentication, terminal open, terminal input, or
terminal output was sent during these Session 05 WSS checks.

## Allowed/denied matrix

| Case | Expected | Result and layer |
| --- | --- | --- |
| Installed valid ClientAuth identity to private `/healthz` | Allow | HTTP 200 / `ok`, twice; tailnet + raw TCP + agent TLS/mTLS |
| Installed valid identity, exact Origin and subprotocol to `/terminal` | Allow WSS upgrade | Connected; negotiated `terminus.v0_1`; application auth intentionally not attempted |
| No client certificate | Deny during TLS | curl exit 56, HTTP 000 |
| Unrelated private-key certificate | Deny during TLS | `WebException`; no HTTP application response |
| Wrong Origin with valid mTLS | Deny before upgrade/application auth | HTTP 403 |
| Wrong subprotocol with valid mTLS and exact Origin | Deny before application auth | HTTP 426 |
| Direct loopback origin | Reachable only locally | TCP 127.0.0.1:8443 connected |
| Direct Tailscale-interface origin port | Deny | TCP 100.82.31.104:8443 did not connect |
| Direct LAN origin port | Deny | TCP 192.168.1.8:8443 did not connect |
| Private publication port | Reachable on tailnet path | TCP 100.82.31.104:443 connected; mTLS request succeeded |
| Funnel/public publication | Deny | Active CLI status says `tailnet only`; JSON contains raw TCP forward only |
| Wrong tailnet device or non-operator identity | Deny by policy, then still require mTLS/app auth | Not independently exercised; no second controlled identity and no admin-policy read access |

The public DNS name resolves to `100.82.31.104`, an RFC 6598 shared-address
range address rather than a public Internet destination. Combined with the
active `tailnet only` route and absent Funnel configuration, this supports the
private-publication conclusion. It is not an external non-tailnet HTTP probe.

## Separation of controls

The successful TLS and WSS upgrade does not authorize a shell. Tailscale device
reachability, route privacy, certificate verification, exact Origin,
subprotocol, pairing, credential challenge-response, authorization expiry,
revocation, and one-terminal-per-connection state are distinct gates. Tailscale
identity does not replace application authentication, and a successful
`tailscale ping` would not prove TCP, TLS, WSS, or terminal access; no ping is
used as endpoint evidence here.

## Commands and outcomes

```text
tailscale version
PASS: 1.102.3.

tailscale status --json
PASS: backend Running; exact self/tailnet/key-expiry facts recorded above.

tailscale serve status
tailscale serve status --json
tailscale funnel status
PASS: one raw TCP 443 -> 127.0.0.1:8443 route, labelled tailnet only.

Get-NetTCPConnection -State Listen -LocalPort 8443
PASS: only 127.0.0.1:8443, PID 5384.

Invoke-WebRequest ... -Certificate <existing CurrentUser identity>
PASS twice: HTTP 200, body ok.

curl.exe --tlsv1.3 ... https://sai.tailf8dcea.ts.net/healthz
PASS negative: exit 56, HTTP 000 without client certificate.

ClientWebSocket exact/wrong-Origin/wrong-subprotocol probes
PASS: exact connected; wrong Origin HTTP 403; wrong subprotocol HTTP 426.
```

The first sandboxed status/listener attempt failed with access denied and made
no change. The authorized read-only rerun produced the live snapshot. The first
certificate-store enumeration incorrectly reported zero candidates because it
queried the provider's enhanced-usage property with the wrong object shape;
exact selection and direct extension parsing then confirmed the existing leaf
and ClientAuth EKU. Neither failed attempt changes the final evidence.

## Limits and handoff

- This review does not claim tailnet administrator privileges, node approval,
  complete grant/ACL narrowness, or an independently denied tailnet identity.
- It does not claim an external public-network HTTP attempt. Route state,
  RFC 6598 addressing, loopback binding, and Funnel-disabled evidence are
  explicit; S06 may add an external vantage.
- It does not claim full application pairing/authentication, terminal data, or
  reconnect/resume. Session 02/06 must verify those without logging plaintext.
- It does not claim Chrome/Firefox Android/iPhone certificate behavior. The
  acceptance remains one certificate installation/selection and pairing per
  device, followed by silent identity and credential reuse on reconnect.

Within those limits, the TLS/private-publication design is correct and the
previous S05-005 blockers are resolved. S05-006 owns the complete read-only
route snapshot and allowed/denied network handoff.
