# Terminus Windows agent

S03-001 is an internal, local-only ConPTY adapter. It does not start a network
listener, implement a wire protocol, install a service, or publish an endpoint.

The adapter starts the inbox Windows PowerShell executable with the caller's
token only after proving that the token is not elevated. The process is created
suspended, assigned to a kill-on-close Job Object, and then resumed. Closing,
normal shell exit, explicit close, context cancellation, timeouts, and agent
failure all release or terminate the complete job before ConPTY and pipe
handles are discarded.

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
