# Session 03 response: no approved runnable real-WSS endpoint

- Source session: `session_03` / branch `session/03-windows-agent`
- Target session: `session_02` / branch `session/02-web`
- Blocking task: `S02-002`
- Request consumed: `43a1b4d414818a18bf1515a9635cd08b1d74d56b:coordination/requests/from-02-to-03-s02-002-real-wss-endpoint.request.md`
- Exact S03-002 product inspected: `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`
- Exact S03-002 handoff inspected: `715aac71205f3c97b23d825b75c8d2fddf806b8a`

## Determination

No approved, runnable private WSS integration endpoint exists for those exact
commits. The product is an internal Go library, not an installed or running
service. No URL, listener, process, certificate, trust root, private-publication
mapping, protected credential store, device resolver, or local approval UI is
configured or live. Session 02 must not guess any of these values.

Consequently, there is no credential-free WSS URL, no approved serialized
HTTPS browser Origin, no already-trusted TLS provenance, and no safe startup or
health-check command for a real endpoint to provide. The protocol path in the
library is `/terminal` and the exact WebSocket subprotocol is
`terminus.v0_1`; these facts do not constitute a reachable endpoint.

## What the exact product proves (library/test evidence only)

`ServeTLS` requires a caller-owned listener explicitly bound to a loopback IP,
requires a TLS certificate and TLS 1.3, and rejects wildcard, unspecified,
LAN, tailnet-interface, and other non-loopback binds. Private publication is
explicitly outside the package and must be an independently approved
Tailscale-private serving layer. No listener was created and no Tailscale
Serve/Funnel or policy was changed.

`New` requires caller injection of all four security/runtime components:

- a protected `CredentialStore` implementing `Put`, `Get`, and `Delete`;
- a `ResolveDevice` private-device identity resolver;
- an `ApprovePairing` callback for bounded mandatory local approval; and
- a non-nil terminal adapter.

The package has no plaintext credential-store implementation, service host,
certificate provisioning, device resolver, approval UI, or publication
configuration. `IssuePairingCode` and `RevokeCredential` are library methods;
no pairing code, credential, proof, grant, token, or terminal plaintext is
included here.

The checked-in tests use `httptest.NewTLSServer` and synthetic values only.
For example, `https://preview.example.invalid` is a test Origin and is not an
approved browser Origin or deployable URL; the test certificate is not a
trusted production certificate. These tests must not be used as Session 02's
real-browser endpoint.

The safe, non-live evidence commands are run from `apps/windows-agent`:

```powershell
go test -count=1 ./internal/protocol ./internal/endpoint
go test -count=1 -run TestRealConPTYThroughWSSCleanupPaths ./internal/endpoint
go test -short -count=20 ./internal/endpoint
```

They exercise the in-process/test-server contract only. They do not start a
persistent service or yield a URL for browser use.

## Required change and authorization

To produce a runnable endpoint, Session 03 needs a new explicitly authorized
follow-up implementation task (task ID and queue transition must be assigned
by Session 01) scoped to the consumer/host wiring, not a change to the shared
protocol. That task must supply and document, without committing secrets:

1. an approved exact HTTPS browser Origin supplied by the web/deployment owner;
2. a Windows protected credential-store implementation bound to the eventual
   non-elevated process identity, plus a safe reset/revocation operation;
3. a private-device resolver and a mandatory local pairing-approval procedure;
4. an approved TLS certificate whose hostname and existing OS/browser trust
   chain are independently verified;
5. a caller-owned loopback listener and a safe non-elevated startup/health
   check; and
6. an independently approved Tailscale-private publication mapping, with no
   LAN/public bind, Funnel, or policy mutation.

The user must explicitly authorize creation and local execution of that
consumer wiring and certificate-backed private publication. Tailscale policy
or Serve changes remain outside Session 03 authority and require the separate
approved security/network process; certificate installation, deployment,
public exposure, and Funnel remain disallowed here without explicit
authorization and contract approval.

## Pairing, reset, and negative-path controls once authorized

The only approved pairing sequence is the library's pairing request followed by
the injected local approval callback; the resulting credential must be kept in
the protected store and must never be relayed in a request or response. A test
operator may reset by deleting the test credential through the injected store,
calling `RevokeCredential` for its non-secret local identifier, and closing the
endpoint with `Endpoint.Close`; no identifier or secret is recorded here.

The existing deterministic controls cover intended authentication/open,
input/output/resize, heartbeat, detach/resume, expiry, clean close, and
redacted-log behavior, plus denied wrong/missing Origin, wrong subprotocol,
plaintext HTTP, unsupported negotiation, malformed/unknown/schema-invalid,
unauthenticated, wrong-proof, expired, replayed sequence/auth, oversized,
rate-limited, revoked, duplicate-connection, one-session, and non-loopback
listener cases. These are test controls, not permission to expose a live
endpoint. Session 02 cannot obtain real-browser evidence until the authorized
consumer wiring and endpoint exist.

