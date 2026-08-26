# Terminus Windows agent

The agent contains the S03-001 ConPTY adapter and the S03-002 protocol 0.1
HTTPS/WSS endpoint. It is still an internal library: it does not install a
service, change Tailscale policy, enable Funnel, or publish a live endpoint.

The adapter starts the inbox Windows PowerShell executable with the caller's
token only after proving that the token is not elevated. The process is created
suspended, assigned to a kill-on-close Job Object, and then resumed. Closing,
normal shell exit, explicit close, context cancellation, timeouts, and agent
failure all release or terminate the complete job before ConPTY and pipe
handles are discarded.

## Private endpoint boundary

`internal/endpoint` consumes the exact protocol/security cumulative product
tip `910b69e24f464bb3e89152f3e5881beb9b706b76`. It requires TLS 1.3 and an
already-created listener explicitly bound to a loopback IP. The only supported
publication model is an independently approved Tailscale-private serving layer
in front of that loopback origin. Wildcard, LAN, tailnet-interface, plaintext,
and public listener binds are rejected by this package.

The endpoint accepts only `/terminal`, the exact `terminus.v0_1` WebSocket
subprotocol, and one configured serialized HTTPS Origin. Pairing, credential
authentication, per-direction sequencing, payload limits, heartbeat/liveness,
one terminal, detach/resume, output backpressure, and cleanup are enforced in
process. A caller must inject a private-device identity resolver, mandatory
local pairing confirmation, and a credential store protected with the Windows
facility appropriate to the eventual service identity. There is deliberately
no plaintext credential-store implementation. Store deletion is part of the
interface so local revocation atomically closes matching authorizations and
active or detached terminal sessions.

## Temporary integration host

`cmd/integration-host` is a Windows-only, non-elevated local harness around the
endpoint library. It refuses to start unless the caller supplies one exact
HTTPS Origin, a server certificate/key pair, a certificate hostname, a trusted
client-CA bundle, and a non-secret device label. The server certificate must
already chain to the current Windows user's trusted roots and cover the
hostname; the host never generates, installs, or trusts a self-signed
certificate. Client certificates signed by the supplied CA are required and
their SHA-256 fingerprints are used as the private-device identity. The
listener default is `127.0.0.1:0` and non-loopback binds are rejected before
and after binding.

The host encrypts its temporary credential map with DPAPI `CurrentUser`, so
records are bound to the non-elevated integration identity. The default store
is removed after clean shutdown. Use an explicit path only when its lifecycle
is managed by the operator. The pairing approval prompt is bounded by the
endpoint's 60-second limit and prints no client or credential data.

Safe commands (run from this directory, with an externally supplied already
trusted certificate) are:

```powershell
go run ./cmd/integration-host -mode serve -listen 127.0.0.1:0 -origin <exact-https-origin> -server-name <certificate-hostname> -cert <existing-cert.pem> -key <existing-key.pem> -client-ca <existing-client-ca.pem> -device-id local-integration-device -print-pairing-code
Invoke-WebRequest https://<certificate-hostname>/healthz
go run ./cmd/integration-host -mode revoke -store <protected-store-path> -revoke-id <credential-id>
go run ./cmd/integration-host -mode reset -store <protected-store-path>
```

The pairing-code flag is explicit operator-console output only; never redirect
it, log it, or commit it. Do not use the synthetic `httptest` certificates in
the tests for browser integration. Until an already-trusted certificate and
approved private publication mapping are supplied, no real WSS URL exists.

## Development checks

Run these from this directory on a non-elevated Windows 10 version 1809 or
newer, or Windows Server 2019 or newer:

```powershell
go fmt ./...
go vet ./...
go test ./...
go test -race ./...
```

The Windows integration tests use synthetic markers, do not print terminal
output, and must not be run from an elevated shell.

The race build requires a supported C compiler on Windows. When one is not
available, run repeated endpoint concurrency tests with `go test -count=20
./internal/endpoint` and record the unavailable race precondition rather than
installing a compiler.

## Verified API sources

- Microsoft, Creating a Pseudoconsole session:
  <https://learn.microsoft.com/windows/console/creating-a-pseudoconsole-session>
- Microsoft Terminal discussion, redirected parent standard handles with
  ConPTY (`STARTF_USESTDHANDLES` with null handles):
  <https://github.com/microsoft/terminal/discussions/15814>
- Microsoft, ClosePseudoConsole:
  <https://learn.microsoft.com/windows/console/closepseudoconsole>
- Microsoft, Job Objects:
  <https://learn.microsoft.com/windows/win32/procthread/job-objects>
- Go `x/sys/windows` v0.47.0 source and API:
  <https://pkg.go.dev/golang.org/x/sys@v0.47.0/windows>
- Gorilla WebSocket v1.5.3 source and API (read limit, one-reader/one-writer
  concurrency contract, control frames, and exact subprotocol selection):
  <https://pkg.go.dev/github.com/gorilla/websocket@v1.5.3>
