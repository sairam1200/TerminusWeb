# S05-005 private mTLS publication recommendation

Status: recommendation only; no Tailscale, certificate, DNS, listener, or endpoint mutation performed.

## Inputs and blockers

- Host product: S03-003 cumulative `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`.
- Requested private hostname: `sai.tailf8dcea.ts.net`.
- The locally observed server certificate is self-signed `CN=localhost`; its names do not cover the requested hostname and its chain is not trusted. It must not be used.
- The browser client certificate metadata lacks explicit `Client Authentication` EKU. It must be regenerated or replaced with explicit ClientAuth EKU and a trusted client-CA chain; it is not approved as-is.
- Exact Vercel Preview Origin is still required from Session 01 and must be supplied verbatim to `-origin`.

## Compatibility decision and topology

Ordinary layer-7 HTTPS Serve terminates TLS at Tailscale. That would consume the browser client certificate at the Serve boundary and cannot preserve the client certificate for the Windows agent’s `RequireAndVerifyClientCert` handshake. It is therefore incompatible with the agent’s end-to-end browser mTLS requirement.

Use layer-4 raw TCP Serve instead:

```text
Vercel preview browser (exact Origin, client cert)
  -> Tailscale private TCP Serve: sai.tailf8dcea.ts.net:443
  -> raw TCP forward to 127.0.0.1:<verified-agent-port>
  -> Windows agent TLS 1.3 + client-CA verification + /terminal WSS
```

The proposed operator configuration, only after explicit authorization and after all blockers are resolved, is:

```powershell
tailscale serve --tcp=443 tcp://127.0.0.1:<verified-agent-port>
```

Do not use `--https`, `https://...`, `--tls-terminated-tcp`, `--set-path`, or Funnel. Raw TCP has no Serve path rewriting; the browser’s HTTPS request path remains `/terminal` and is validated by the agent.

## Matrix

| Flow | Expected result | Gate |
|---|---|---|
| Approved tailnet browser + valid client cert + exact Origin → `https://sai.tailf8dcea.ts.net/terminal` | Allowed after pairing/auth | All certificate, Origin, policy, and app gates |
| Approved tailnet browser, invalid/expired/revoked client cert | Denied during TLS | Client-CA and revocation checks |
| Wrong Origin or subprotocol | Denied before terminal allocation | Agent protocol checks |
| Wrong device identity / unapproved tailnet peer | Denied | Tailscale grant plus mTLS/device binding |
| LAN direct to agent port | Denied/unroutable | Loopback bind and host firewall |
| Public Internet/Funnel | Denied | Funnel remains disabled; external probe must fail |
| Wildcard/LAN/Tailscale-interface agent bind | Refused before bind | Host validation |

## Certificate and Origin requirements

- Server certificate: trusted by browser/OS, SAN exactly covers `sai.tailf8dcea.ts.net`, ServerAuth EKU, valid chain, private key retained out-of-band, expiry recorded with renewal/rollback owner.
- Browser certificate: trusted client-CA chain, explicit ClientAuth EKU, unexpired/not-yet-valid bounds, fingerprint bound to the approved device identity; private key never enters the repository.
- Agent TLS: TLS 1.3 minimum, `RequireAndVerifyClientCert`, supplied client-CA bundle.
- Origin: exact Vercel Preview Origin supplied by Session 01; no wildcard, substring, or guessed production origin.

## Deterministic live verification (authorized operator only)

1. Snapshot current Serve/Funnel config, tailnet policy revision, listener table, firewall profiles/rules, certificate subjects/SAN/EKU/expiry/fingerprints, and rollback identifiers without secrets.
2. Confirm hostname resolves to the intended node and the node/tag/device identity matches the approval.
3. Confirm Funnel is disabled and no existing route owns TCP 443.
4. Start the already-reviewed host with the externally supplied trusted server cert, client CA, exact Origin, and explicit loopback port; verify no non-loopback listener.
5. Apply the raw TCP Serve command above.
6. From the approved browser/device, verify TLS chain/hostname, exact Origin, client-cert acceptance, pairing/auth, `/terminal` WSS, and non-secret health response.
7. From denied LAN/public/wrong-device/wrong-Origin clients, verify connection or handshake denial; verify no terminal allocation or plaintext logs.
8. Recheck Serve status, Funnel status, listeners, firewall, and expiry metadata.

## Rollback

```powershell
tailscale serve status
tailscale serve reset
```

Use `tailscale serve reset` only after capturing the complete pre-change Serve config and only to remove the newly authorized route; restore any unrelated prior mounts from the snapshot. Stop the host, revoke the test credential, and restore the prior certificate/configuration out-of-band. If any public or LAN path succeeds, stop immediately and restore the captured state.

Raw TCP Serve preserves end-to-end TLS but does not itself replace Tailscale grants, application pairing, authorization, expiry, or Origin enforcement.
