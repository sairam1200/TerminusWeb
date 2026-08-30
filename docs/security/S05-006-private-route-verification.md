# S05-006 existing private raw-TCP route verification

Status: owner verification complete against the already-correct route. Session
05 did not reconfigure it. This is not Session 06 `verified` evidence.

## Exact inputs and authorization boundary

- Authoritative queue: `8e87e8f422bc10f77573e41555d6d46d237431ad`;
  S03-004 and S05-001 are `done`, and S05-006 is `ready` with user
  authorization for the private raw-TCP route.
- Exact endpoint-ready product:
  `ce5ac98b8a79abd42fee6083345709c77aaf669c`.
- Exact endpoint-ready handoff:
  `ec1e6520acfb7775b1ce20da5b83719c6df3d4c4`.
- Reviewed S05-005 live design product:
  `e4a362922f2487b685d06e27dd02bd2f7b52e656`.

The correct mapping and live non-elevated host predated this task. The task
authorized verification, but explicitly prohibited altering a correct route,
grants/ACLs, DNS, Funnel, certificates, or public exposure. No live mutation
was performed.

## Pre/post state

`tests/security/Test-S05-006.ps1` captured the complete selected device, route,
audience, listener, process, firewall-profile, and DNS facts before and after
the probes. Both canonical snapshots were byte-identical, with SHA-256:

```text
2bf95fce25f37fdbaaa7580aedb7a27f5cb481d9c8872001fcf78fa055956329
```

The stable snapshot contained:

- Tailscale `1.102.3`, backend `Running`;
- tailnet/login `sairamch10@gmail.com`;
- self DNS name `sai.tailf8dcea.ts.net`, online, no tags, key expiry
  2027-02-16;
- exactly one Serve JSON section, `TCP`, with exactly port 443 and
  `TCPForward` `127.0.0.1:8443`;
- Serve and Funnel display state both marking the mapping `tailnet only`;
- exactly one origin listener, `127.0.0.1:8443`, owned by PID 5384
  `integration-host`;
- current Windows firewall profile defaults and public-resolver A record;
- public DNS resolving the name to `100.82.31.104`, in the RFC 6598
  shared-address range.

There is no `HTTPS`, HTTP handler, path handler, `TLS-terminated TCP`, proxy
protocol, wildcard/LAN origin, or Funnel audience in the active route. Raw TCP
therefore preserves the browser TLS bytes through Tailscale to the agent's TLS
1.3/mTLS boundary, and `/terminal` remains agent-validated.

## Allowed, denied, boundary, and failure matrix

| ID | Path | Expected | Live result |
| --- | --- | --- | --- |
| ALLOW-01 | Existing installed ClientAuth identity -> private `/healthz` | Allow | HTTP 200 and body `ok` twice |
| ALLOW-02 | Valid identity + exact Origin + `terminus.v0_1` -> `/terminal` | Allow WSS upgrade | Connected and negotiated `terminus.v0_1`; no app frame sent |
| ALLOW-03 | Local host -> loopback origin 8443 | Allow local TCP | Connected |
| ALLOW-04 | Tailnet address -> published 443 | Allow private TCP | Connected; ALLOW-01 proves TLS/application health through it |
| DENY-01 | No client certificate | Deny during TLS | curl exit 56, HTTP 000 |
| DENY-02 | Unrelated installed private-key certificate | Deny wrong application device | `WebException`; no HTTP application response |
| DENY-03 | Valid mTLS + hostile Origin | Deny before WSS/application auth | HTTP 403 |
| DENY-04 | Valid mTLS + exact Origin + wrong subprotocol | Deny before application auth | HTTP 426 |
| DENY-05 | Tailscale interface -> raw origin port 8443 | Deny | TCP did not connect |
| DENY-06 | LAN interface -> raw origin port 8443 | Deny | TCP did not connect |
| DENY-07 | Funnel/public publication | Deny | Active state says `tailnet only`; config has raw TCP forward only |
| BOUND-01 | Pre/post route and host state | Remain identical | Same canonical snapshot and SHA-256 |
| FAIL-01 | Missing/invalid certificate | Fail before HTTP/WSS | DENY-01 and DENY-02 passed |
| FAIL-02 | Wrong browser security metadata | Fail before terminal allocation | DENY-03 and DENY-04 passed; no protocol frame sent |

The unrelated certificate is a live negative for the agent's certificate-based
private-device identity. It is not a separately controlled Tailscale peer. No
second tailnet identity was available from this execution surface, and the
complete additive grants/ACLs and device-approval state were not readable.
Accordingly, the task proves private tailnet-only publication plus independent
mTLS/application-device rejection, but does not claim a live network-policy
denial from a named non-operator peer.

No external public HTTP probe was available: the browser/web fetch tool refused
the private hostname as unsafe. The active tailnet-only route, absent Funnel
mode, loopback origin, and RFC 6598 destination are the public-boundary evidence.
Session 06 may add a controlled external vantage without changing exposure.

## Certificate and reconnect acceptance

The selected existing Windows CurrentUser identity has a private key, current
validity, and explicit ClientAuth EKU `1.3.6.1.5.5.7.3.2`. The two successful
requests reused that installed identity without import or generation. The WSS
check also reused it. No pairing code, credential, terminal frame, or user
terminal content was created or inspected.

This proves reusable Windows-store identity behavior, not Chrome/Firefox on
Android/iPhone. Product acceptance remains: certificate installation/selection
and pairing occur once per device; reconnect/resume silently reuse the device
identity and stored application credential. Session 02/06 owns the browser and
full reconnect proof.

## Rollback evidence

Because Session 05 did not mutate the existing correct mapping and the pre/post
snapshots are identical, the safe rollback for this task is **no action**.
Resetting Serve merely to demonstrate rollback would remove a working private
route and violate the task boundary.

Installed CLI `--help` checks passed for `serve get-config`, `serve set-config`,
and `serve reset`. A read-only attempt to export `get-config --all` emitted only
the service-config version and left the requested file empty; it did not capture
this node-local raw TCP mapping. It must not be treated as a restorable snapshot
for this route. The reproducible live snapshot is `serve status --json`, and the
exact reconstruction is raw TCP port 443 to `127.0.0.1:8443`, only under fresh
explicit mutation authorization. `serve reset` is an emergency removal tool,
not a routine test, and must first be checked against the complete current
configuration so unrelated mounts are not erased.

If any later check observes public/LAN origin access, TLS termination, path
rewriting, a different target, or an unexpected route, stop testing, capture the
new complete state, remove public exposure under explicit incident authority,
and restore only the exact approved raw TCP mapping. None of those conditions
occurred here.

## Reproducible command evidence

```text
powershell -NoProfile -ExecutionPolicy Bypass -File \
  tests/security/Test-S05-006.ps1 \
  -ClientCertificateThumbprint <existing-public-certificate-identifier>

PASS: exact raw TCP private route and identical pre/post snapshot hash.
PASS: existing ClientAuth identity succeeded twice; unrelated/no certificate failed closed.
PASS: exact WSS upgraded; wrong Origin=403 and wrong subprotocol=426.
PASS: loopback origin allowed locally; LAN/Tailscale direct origin denied; Serve 443 allowed.
LIMIT: no independent wrong-tailnet-peer, complete-policy, device-approval,
external-public, or mobile-browser probe.
```

The harness accepts the public certificate identifier as a parameter and never
prints it. It reads public certificate metadata only and does not export or read
private-key bytes. It performs no pairing/authentication or terminal action.

The first three harness attempts failed closed before completion due,
respectively, an optional Tailscale JSON field under strict mode, an emitted
`VoidTaskResult` from the WSS call, and native help output capture. Each cause
was corrected without live mutation; the final full run passed. The first
rollback-export syntax attempt placed `--all` after the output path and was
rejected; the corrected read-only attempt exposed the node/service snapshot
limitation described above. Safe-stop was not triggered because the failures
had distinct underlying causes.

`tailscale ping` was not used. It would not prove TCP policy, a listener, TLS,
WSS, application authorization, or private publication.

## Remaining release gates

- Audit the complete current grants/ACLs and device approval from an authorized
  policy surface; matching grants are additive and the self node is untagged.
- Run a named non-operator/wrong-tailnet-peer denial without sharing the valid
  client certificate.
- Add an external non-tailnet public denial if Session 06 has a controlled
  vantage.
- Verify Chrome and Firefox on Android and iPhone, including one-time
  certificate selection/pairing and silent reconnect identity reuse.
- Verify full application pairing/authentication/resume and terminal cleanup
  without recording terminal plaintext.

These are accurately bounded follow-on gates. They do not change the observed
fact that the current mapping is raw TCP, loopback-backed, and tailnet-only.
