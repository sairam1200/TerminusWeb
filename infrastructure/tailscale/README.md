# S05-001 proposed Tailscale policy

Status: proposal only; not compiled by Tailscale and not applied to a tailnet.

`policy.fragment.template.hujson` is a strict-JSON subset of HuJSON containing the
Terminus-specific entries proposed for a future tailnet policy. It is deliberately
not paste-ready. The unresolved tokens prevent unknown live identities and ports
from being presented as verified facts.

## Proposed grant

| Field | Proposed value | Meaning |
| --- | --- | --- |
| Source | `group:terminus-terminal-operators` | Only explicitly listed tailnet user identities. This is not `autogroup:member`, `autogroup:admin`, or `*`. |
| Destination | `tag:terminus-windows-agent` | Only the separately verified Windows agent node. |
| Protocol | `tcp` | HTTPS/WSS transport only. |
| Destination port | `__TERMINUS_SERVE_HTTPS_PORT__` | The verified Tailscale Serve HTTPS listener port; expected to be `443` only if live inspection later confirms it. |

The proposal contains no SSH rule, no RDP grant, no UDP grant, no ICMP grant,
no subnet route, no exit-node permission, no auto-approver, and no Funnel node
attribute. Tailscale grants are additive, so this fragment is deny-by-default for
Terminus only when the complete live policy contains no other ACL or grant that
also matches the selected source or destination.

The explicit tag-owner entry is separated from terminal access: it names only the
exact identities substituted into `group:terminus-agent-tag-admins`, and membership
in that group does not itself grant the terminal port. Tailscale's privileged
Owner/Admin/Network Admin roles can edit policy, and documented administrative
roles can have broader tag-assignment authority, so this separation is not a
control against a malicious tailnet administrator. Administrative changes require
independent audit and recovery controls. An administrator who needs ordinary
terminal access must also be explicitly listed as a terminal operator.

## Required substitutions

| Token | Required verified value |
| --- | --- |
| `__TERMINUS_OPERATOR_IDENTITY__` | Exact login identity of an intended terminal operator. Add separate array entries for additional approved operators. |
| `__TERMINUS_TAG_ADMIN_IDENTITY__` | Exact login identity allowed to assign the agent tag. |
| `__TERMINUS_DENIED_IDENTITY__` | Exact existing tailnet identity that is intentionally outside the operator group and can act as the negative control. |
| `__TERMINUS_SERVE_HTTPS_PORT__` | Numeric private Serve HTTPS port confirmed from the target node and current client documentation. |

Do not substitute a public IP, a LAN subnet, `*`, or an `autogroup` for the
operator identity. Do not copy the fragment over the complete policy. Top-level
sections must be merged with their current live counterparts only during a
separately authorized change.

## Facts, assumptions, and unresolved state

Verified repository facts:

- The browser-to-agent terminal path must be direct and Tailscale-private.
- The Windows application origin must stay on loopback.
- Tailscale Serve is the proposed private publication boundary; Funnel and public
  terminal or SSH exposure are outside the approved architecture.
- Tailscale identity and policy do not replace application pairing,
  authentication, authorization, expiry, or exact WebSocket Origin validation.

Unverified live facts:

- Signed-in tailnet, operator role, exact user identities, node identity and tag,
  Tailscale addresses, client version, approval state, key expiry, and current
  ACL/grant coverage.
- Current listener addresses, host firewall rules, Serve routes, Funnel state,
  MagicDNS name, certificate state, and private HTTPS port.
- Whether the intended iPhone/browser device can reach the selected private Serve
  endpoint with the required browser behavior.

Proposal assumptions to validate before any change:

- The target Tailscale plan supports every selected feature.
- The Windows service node can use a non-human tag identity without breaking
  required recovery behavior; applying a tag replaces user ownership of that
  Tailscale device and must be an explicit enrollment decision.
- The chosen operator identity represents the intended browser device, and device
  approval/key-expiry controls are enabled and enforced as designed.
- No broader existing ACL, grant, shared-device rule, route, or local-network path
  bypasses this fragment.

## Private publication boundaries

```text
iPhone browser/Tailscale identity
        |
        | TCP <verified Serve HTTPS port>, policy allowed
        v
Tailscale Serve on the Windows node (tailnet-private HTTPS/WSS)
        |
        | reverse proxy on the same host
        v
127.0.0.1:<verified agent origin port>
```

- The agent origin binds only to `127.0.0.1` (and to `::1` only after an explicit
  IPv6 loopback decision and test). It must not bind `0.0.0.0`, `[::]`, a LAN
  address, or a Tailscale address.
- Serve may publish the loopback origin to policy-authorized tailnet peers. A
  `*.ts.net` name is not proof of public exposure; the active Serve/Funnel state
  determines the audience.
- Funnel accepts public-internet traffic and is prohibited for Terminus. The same
  port cannot be treated as both private Serve and public Funnel; active route
  state must be checked, not inferred from a hostname.
- Network permission reaches only the WSS listener. The Windows agent must still
  reject an unpaired browser, an invalid or absent application credential, an
  expired session, a replay, and an unexpected `Origin`.

## Proposed pre-change and rollback procedure

These are future steps for an explicitly authorized operator. They were not run
for S05-001.

1. Verify the visible tailnet/account and operator role. Record the target's stable
   node identity, owner/tag, addresses, client version, approval, key expiry,
   advertised/accepted routes, and current Serve/Funnel status without recording
   credentials.
2. Capture the complete current policy and its source-of-truth revision. Capture
   the complete target Serve/Funnel route configuration, listener table, firewall
   state, and service configuration. Hash or otherwise identify the snapshots.
3. Resolve every token above. Audit all existing ACLs and grants because matching
   rules combine permissions; a narrow rule does not subtract broader access.
4. Merge the proposal in the policy source of truth. Run Tailscale's policy
   compiler and embedded tests in preview/validation mode before saving. Do not
   add a Funnel attribute or an SSH rule.
5. During a separately authorized change window, apply the smallest policy-only
   change. Verify the allowed and denied cases in `docs/security/S05-001-threat-model.md`
   from the named test identities and devices.
6. Roll back immediately if any expected allowed case fails, any denied case
   succeeds, unrelated tailnet access changes, or the service becomes public.
   Restore the exact captured policy through its actual source of truth (admin
   policy, API, or GitOps). If route configuration changed under a separate
   authorization, restore the captured per-port Serve/Funnel mappings without
   resetting unrelated mounts.
7. Re-run the negative controls and confirm the loopback listener, private Serve
   route, Funnel-disabled state, and unrelated connectivity after rollback.

Do not use `tailscale ping` as endpoint proof. A peer ping can establish a
tailnet path (and TSMP diagnostic pings can stop before access-policy evaluation),
but it does not prove that TCP is allowed, TLS/WSS is listening, Serve is private,
or application authentication succeeds.

## Local static check

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/security/Test-S05-001.ps1
```

This check parses the template, rejects broad selectors and exposure-related
sections, and verifies the embedded positive and negative policy assertions. It
does not compile policy with Tailscale, inspect a tailnet, or test a service.

## Primary documentation checked

- Tailscale grants syntax (validated 2026-01-05):
  https://tailscale.com/docs/reference/syntax/grants
- Tailnet policy and test syntax (validated 2026-04-08):
  https://tailscale.com/docs/reference/syntax/policy-file
- Tailscale Serve examples (validated 2026-01-14):
  https://tailscale.com/docs/reference/examples/serve
- Tailscale Funnel boundary and requirements (validated 2026-01-20):
  https://tailscale.com/docs/features/tailscale-funnel
- Tailnet policy management and diagnostic-ping limits:
  https://tailscale.com/docs/features/tailnet-policy-file/manage-tailnet-policies
