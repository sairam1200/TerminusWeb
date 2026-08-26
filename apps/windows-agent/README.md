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
