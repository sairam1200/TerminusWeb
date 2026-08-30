# S03-004 authorized endpoint-ready evidence

- Date: 2026-08-30
- Authoritative queue: `e9b6dd023178c18638e03b96cfd0543670c7d7f3`
- Exact implementation input: `e13c4c8d2659125476c7458b45720892ee49fc24`
- S03-003 runnable-host dependency: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- S06-006 Origin evidence: `14ecdd5cbaf00b75dfeec6f7391038a66f391dd5`
- Runtime identity: non-elevated `sai\saira` on Microsoft Windows NT `10.0.26200.0`

## Live endpoint

The reviewed integration host is running with the externally supplied server
certificate/key and client-CA bundle. The sensitive inputs remain out of band;
no certificate or private-key bytes are copied into this repository or output.

- Browser Origin: `https://terminus-web.vercel.app`
- Private endpoint: `wss://sai.tailf8dcea.ts.net/terminal`
- Protocol: `terminus.v0_1`
- Agent origin listener: `127.0.0.1:8443`
- Health path: `/healthz`
- Credential storage: explicit DPAPI `CurrentUser` store under the operator's
  local Terminus application-data directory
- Pairing: mandatory bounded local approval remains enabled; the host was
  intentionally started without `-print-pairing-code`

At capture time, `netstat -ano -p TCP` reported only
`127.0.0.1:8443 ... LISTENING 5384`. No wildcard, LAN, or tailnet-interface
agent listener was present. The persistent operator session remains running so
Sessions 02, 05, and 06 can perform their separately owned checks.

## TLS and health results

Host startup passed `tls.LoadX509KeyPair`, hostname verification, ServerAuth
usage validation, current-user Windows chain validation, client-CA loading,
TLS 1.3 configuration, and loopback validation. Public certificate metadata
shows the server leaf covers `sai.tailf8dcea.ts.net`, is valid from 2026-08-26
through 2026-11-24, and has Server Authentication EKU. The existing browser
leaf is valid through 2027-02-26, has explicit Client Authentication EKU
`1.3.6.1.5.5.7.3.2`, and verifies to the supplied client CA. No replacement
certificate was needed or generated.

Using the existing installed Terminus browser identity, an mTLS TLS-1.3 GET to
`https://sai.tailf8dcea.ts.net/healthz` returned body `ok` and HTTP `200`.
The same request without a client certificate failed closed with curl exit 56
and HTTP status `000`. A separate direct-loopback lifecycle instance on
`127.0.0.1:56244` returned `ok`/HTTP `200`; after Ctrl+C, netstat reported the
port closed and no credential-store file had been created.

Host output was inspected after the checks. It contained only the fixed
listener/health metadata and generic loopback TLS-handshake EOF events. It did
not contain terminal bytes, commands, pairing material, credentials, proofs,
tokens, private keys, PFX passwords, or reusable hashes.

## Deterministic checks

Run from `apps/windows-agent` with Go `1.26.7` on Windows AMD64:

- `go vet ./...`: PASS.
- `go test -short -count=1 ./...`: PASS.
- `go test -count=1 ./...`: PASS, including the real Windows ConPTY suites.
- `go test -short -count=20 ./internal/endpoint`: PASS in 24.451 seconds.
- `gofmt -l .`: listed 16 unchanged files because this checkout materializes
  committed LF files as CRLF; no source file was rewritten and the worktree
  remained clean before this evidence was added.
- `git diff --check`: required before the product commit.

The existing deterministic host suite covers DPAPI encrypted-at-rest
round-trip/reset/delete, cross-process store locking, revocation markers,
bounded approval, client-certificate device identity, trusted certificate and
hostname rejection, non-elevation, loopback-only binding, endpoint cleanup,
and secret-safe errors. A live reset of the persistent explicit store was not
performed because deleting live credential state was outside this evidence
capture; an attempted sandboxed reset made no change and failed closed with
the generic `integration host unavailable` result.

## Scope and rollback

Session 03 did not generate or install certificates, change Tailscale Serve or
Funnel, change DNS/firewall/policy, expose a LAN/public listener, deploy, merge,
or push. The Session 03 rollback for this runtime is Ctrl+C in the attached
operator session followed by verification that port 8443 is closed. Network
route rollback remains Session 05-owned.
