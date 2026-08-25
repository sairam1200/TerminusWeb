# S05-001 threat model and verification matrix

Status: design review and proposed tests only. No live tailnet, device, listener,
Serve route, Funnel route, application endpoint, or Vercel deployment was
inspected or changed for this task.

## Scope and security objectives

The first slice loads web assets from Vercel and then connects the browser directly
to a user-owned Windows agent over private Tailscale HTTPS/WSS. Terminal input and
output must not traverse or be stored by Vercel or a future control plane.

Protect these assets:

- terminal plaintext, commands, clipboard data, shell environment, and output;
- pairing secrets, application credentials, session keys, and replay state;
- the non-elevated Windows shell and its child-process boundary;
- Tailscale node identity, device approval, tags, keys, policy, and private routes;
- web application integrity, exact allowed origins, and update provenance;
- metadata held by the future control plane without creating a terminal-decryption
  key or administrative backdoor.

Security objectives are least-privilege reachability, authenticated and
authorized application sessions, replay resistance, session expiry, origin
validation, loopback-only origin binding, private-only publication, process
containment, metadata minimization, and recoverable policy changes.

## Trust boundaries and claims

| Boundary | Verified fact | Assumption or unresolved state | Required control |
| --- | --- | --- | --- |
| Vercel to browser | Vercel serves the PWA assets but is not in the terminal data path. | Deployment identity, CSP, dependency integrity, and exact production origins are not yet verified. | Reproducible assets, strict CSP, exact Origin allowlist, no terminal relay or logging. |
| Browser to tailnet | The browser is expected to connect directly over Tailscale-private WSS. | iPhone/browser private-network behavior and the exact source identity/device are unresolved. | Explicit operator identity, approved/non-expired device, TLS, pairing, application authorization, expiry, replay protection. |
| Tailscale policy to Windows node | Tailscale is the proposed connectivity and network-policy plane. | Current tailnet, grants/ACLs, node/tag, approval, expiry, routes, and plan capabilities are unknown. | One additive grant only from the operator group to the agent tag on one TCP port; audit the complete policy. |
| Serve to local origin | Repository architecture requires a loopback Windows origin. | Actual listener and Serve mapping do not exist or were not inspected here. | Bind only loopback; Serve privately proxies only the verified origin port; confirm Funnel is disabled. |
| Network access to application session | Tailscale can restrict device/user reachability. | Protocol 0.1 and consumers are not dependencies of S05-001 and remain outside this review. | Pairing, auth, authorization, expiry, Origin validation, rate/size limits, and replay rejection remain mandatory. |
| Agent to ConPTY/shell | The first shell is non-elevated by design. | Implementation, Windows version, process token, cleanup, and logging are not yet verified. | Non-elevated token, process containment, cleanup, strict log redaction, explicit session owner. |
| Future control plane to terminal path | The future control plane is metadata-only and may authorize but not decrypt terminal traffic. | Its tenancy/RBAC design is a later task. | No relay, plaintext, universal decryption key, silent admin impersonation, or cross-tenant access. |
| Administrators to users | Roles and plans do not imply terminal entitlement; administration must not create a backdoor. | Exact human roles and break-glass process are unresolved. Tailscale policy administrators can change grants and privileged roles retain broad tag authority. | Separate ordinary tag administration, network access, pairing approval, and terminal authorization; require audit and time-bounded recovery for privileged changes. |

## Threat cases

| ID | Actor or failure | Threat and impact | Proposed prevention/detection | Residual or later evidence |
| --- | --- | --- | --- | --- |
| TM-01 | Compromised Vercel asset or dependency | Malicious JavaScript connects to a private agent using ambient tailnet reachability and attempts terminal control or exfiltration. | Exact WebSocket Origin allowlist, CSP, asset provenance, pairing and per-session application auth; Tailscale alone is insufficient. | Session 02/03 implementation and S05-002 adversarial Origin tests. |
| TM-02 | Unapproved tailnet member | A member reaches the agent port because of a broad `*` or `autogroup:member` rule. | Explicit operator group, exact agent tag, one TCP port, policy negative-control identity, audit all additive grants/ACLs. | Compile and run embedded policy tests against the verified complete policy. |
| TM-03 | Compromised operator device | A valid tailnet identity reaches the endpoint from a stolen, stale, or unmanaged device. | Device approval, key expiry, rapid revocation, optional supported posture rules, plus application session expiry and revocation. | Verify actual device controls and recovery behavior; group identity alone covers all matching user devices. |
| TM-04 | Tag takeover | An unauthorized administrator or automation tags another node as the Terminus agent, redirecting credentials or traffic. | Dedicated explicit tag-owner group, stable-node verification, certificate/name checks, narrow auth keys, and change audit. Privileged tailnet administrators remain a trusted control-plane boundary. | Verify tag ownership, privileged-role membership, and enrollment method before use. |
| TM-05 | Public or LAN listener | The agent binds `0.0.0.0`, `[::]`, LAN, or a public interface and bypasses private policy. | Loopback-only origin plus listener/firewall tests; no raw terminal, SSH, or RDP publication. | Windows listener evidence belongs to Session 03/S05-002. |
| TM-06 | Funnel or route confusion | A `*.ts.net` endpoint is assumed private while Funnel makes the route public, or a changed route points at the wrong origin. | Inspect active Serve and Funnel state, prohibit Funnel attributes/commands, capture all mounts, verify origin and application identity. | Future authorized live negative test from a non-tailnet network. |
| TM-07 | Pairing secret theft or replay | Reusable material grants silent future access or a captured frame reopens a session. | Never log reusable pairing material; one-time/expiring pairing, challenge-response, monotonic replay state, revocation. | Contract is unresolved until S01-001; test in S05-002. |
| TM-08 | Cross-site WebSocket request | An attacker-controlled site in an authorized browser opens the private WSS endpoint. | Exact `Origin` validation before upgrade/auth, no wildcard or substring matching, application credentials bound to intended origin/session. | Browser/agent negative tests after consumer handoff. |
| TM-09 | Privilege escalation | Agent or shell launches elevated, escapes containment, or leaves child processes after disconnect. | Non-elevated default, constrained process ownership, cleanup on close/timeout/failure, no public SSH/RDP. | Session 03 Windows evidence and S05-002 review. |
| TM-10 | Sensitive logging | Browser, agent, Vercel, control plane, or diagnostics retain commands, output, secrets, or clipboard contents. | Metadata-only structured logs, redaction tests, no terminal payload capture or screenshots. | Inspect exact implementations and log sinks in S05-002/S05-003. |
| TM-11 | Control-plane or platform admin abuse | A privileged operator silently decrypts, impersonates, or crosses tenant boundaries. | End-to-end keys unavailable to the platform, explicit user pairing/authorization, separated roles, metadata-only audit, no universal key. | Separate S05-003 review after S04-001. |
| TM-12 | Policy lockout or collateral change | Replacing the full policy or resetting Serve removes unrelated access and recovery paths. | Snapshot exact source-of-truth revisions and routes, merge narrowly, preview embedded tests, preserve recovery, restore exact snapshots on failure. | Authorized change-window evidence; GitOps and admin-console rollback methods must not be mixed. |
| TM-13 | DNS/TLS endpoint substitution | A private name or certificate resolves to the wrong node/service, capturing application credentials. | Verify MagicDNS name, stable node, certificate, tag, Serve route, and application identity; bind credentials to the expected endpoint. | Exact hostname/certificate design remains unresolved. |
| TM-14 | Denial of service | Authorized or unauthorized clients exhaust handshakes, sessions, ConPTY processes, or bandwidth. | Pre-auth limits, bounded frames/sessions, timeouts, quotas independent of billing, cleanup, and alerting without plaintext. | Contract and consumer tests in later tasks. |

## Proposed policy assertion matrix

The first six cases are embedded in
`infrastructure/tailscale/policy.fragment.template.hujson`. These assertions test
network policy only; they do not prove a listener or application works.

| ID | Source | Destination | Protocol/port | Expected | Evidence layer |
| --- | --- | --- | --- | --- | --- |
| P-ALLOW-01 | `group:terminus-terminal-operators` | `tag:terminus-windows-agent` | TCP / verified Serve HTTPS port | Allow | Embedded Tailscale policy test. |
| P-DENY-01 | Same operator group | Agent tag | TCP/22 | Deny | Embedded Tailscale policy test; no terminal access via SSH. |
| P-DENY-02 | Same operator group | Agent tag | TCP/3389 | Deny | Embedded Tailscale policy test; no RDP. |
| P-DENY-03 | Verified non-operator identity | Agent tag | TCP / Serve HTTPS port | Deny | Embedded Tailscale policy test. |
| P-DENY-04 | Operator group | Agent tag | UDP / Serve HTTPS port | Deny | Embedded Tailscale policy test. |
| P-DENY-05 | Operator group | Agent tag | ICMP/0 | Deny | Embedded Tailscale policy test; ping is not granted as service evidence. |
| P-DENY-06 | Agent tag | Operator group | TCP / Serve HTTPS port | Deny | Embedded Tailscale policy test; grant is directional. |

## Future end-to-end verification matrix

These cases require separately authorized, non-production or controlled live test
identities/devices. None was run for S05-001.

| ID | Starting point | Procedure | Expected result | Distinguishes |
| --- | --- | --- | --- | --- |
| E-LOCAL-01 | Windows agent host | Inspect the process listener and connect directly to `127.0.0.1:<origin-port>`. | Origin is loopback-only and responds according to the application contract. | Local process/listener from Tailscale publication. |
| E-LOCAL-02 | LAN peer or non-loopback interface on the host | Attempt the origin port using the LAN and Tailscale interface addresses. | Connection cannot reach the raw origin. | Loopback binding/firewall from Serve. |
| E-ALLOW-01 | Approved, non-expired operator device | Verify peer state, then connect to the private WSS URL with valid Origin, pairing, and auth. | TCP/TLS/WSS and application session succeed; no Vercel/control-plane relay. | Network path, listener, TLS, Serve, and application authorization. |
| E-DENY-01 | Approved non-operator tailnet device | Attempt the same private HTTPS/WSS port. | Policy denies connection before application access. | Tailnet identity/policy from app rejection. |
| E-DENY-02 | Operator device | Attempt TCP/22 and TCP/3389 on the agent. | Both fail. | Narrow port grant from broad device access. |
| E-DENY-03 | Operator device with invalid/absent pairing credential | Connect to allowed WSS port. | Network connection may succeed; application rejects without terminal allocation. | Tailscale reachability from application authentication. |
| E-DENY-04 | Operator device with hostile or unlisted web Origin | Attempt WebSocket upgrade. | Upgrade/auth fails closed without terminal allocation. | Browser origin from tailnet user identity. |
| E-DENY-05 | Non-tailnet public network | Resolve and connect to the proposed endpoint. | No public Terminus route; Funnel status remains disabled. | Private Serve from public Funnel. |
| E-EXPIRY-01 | Expired/unapproved/revoked test device | Attempt the private endpoint. | Device cannot establish the authorized path. | Device lifecycle from user membership. |
| E-ROLLBACK-01 | Controlled change window | Restore captured policy and any separately changed route mapping, then repeat allow/deny controls. | Prior behavior returns; unrelated routes remain unchanged; no public exposure. | Recoverability and blast radius. |

For diagnostics, a `tailscale ping` result may help distinguish peer-path failure,
but it must never be recorded as proof of TCP policy, a listening port, TLS/WSS,
private Serve configuration, or successful application authorization.

## Decision gates before live use

- Record the real tailnet and operator role without exposing credentials.
- Resolve exact operator, tag-administrator, and denied-control identities.
- Verify the stable Windows node identity, tag, approval, key expiry, addresses,
  client version, and supported plan features.
- Verify the loopback origin port and the private Serve HTTPS port independently.
- Inspect the complete current policy for additive grants, ACLs, SSH rules,
  shared devices, routes, exit-node permissions, and Funnel attributes.
- Resolve the browser private-network compatibility matrix already listed as an
  unresolved repository contract.
- Obtain explicit authorization for any policy, route, tag, device, DNS, or live
  service mutation.
