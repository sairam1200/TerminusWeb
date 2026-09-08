# Terminus Windows agent

The agent contains the S03-001 ConPTY adapter and the private protocol 0.2
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
tip `f9a70299974734c3eeb920697d2dfa4717148a9a`. It requires TLS 1.3 and an
already-created listener explicitly bound to a loopback IP. The only supported
publication model is an independently approved Tailscale-private serving layer
in front of that loopback origin. Wildcard, LAN, tailnet-interface, plaintext,
and public listener binds are rejected by this package.

The endpoint accepts only `/terminal`, the exact `terminus.v0_2` WebSocket
subprotocol, and one configured serialized HTTPS Origin. Pairing, credential
authentication, per-direction sequencing, payload limits, heartbeat/liveness,
one terminal per WebSocket connection, detach/reopen, output backpressure, and
cleanup are enforced in process. Each running terminal has a random 60-bit
`xxxx-xxxx-xxxx` locator bound to its authenticated credential and resolved
private-device identity. Transport loss and connection-authorization expiry
detach the terminal; a newly authenticated connection can atomically reopen it
without repeating pairing. The registry independently tracks every active or
detached terminal session but applies no fixed numeric session cap. Every
valid authenticated connection may attempt to create its one terminal unless
endpoint shutdown has begun; genuine adapter, ConPTY, or system resource
failures use the existing generic `SESSION_OPEN_FAILED` result. A caller must
inject a private-device identity resolver, mandatory
local pairing confirmation, and a credential store protected with the Windows
facility appropriate to the eventual service identity. There is deliberately
no plaintext credential-store implementation. Store deletion is part of the
interface so local revocation atomically closes matching authorizations and
active or detached terminal sessions.

Only terminal output is retained, in volatile process memory, for remembered
sessions. The newest 262,144 bytes per running session are subject to a
16,777,216-byte agent-wide budget; pressure evicts globally oldest bytes without
closing sessions. Replay uses contiguous byte offsets and a snapshot barrier
before live output. Explicit close/New Session, credential expiry or revocation,
process exit, containment loss, and agent shutdown remove the session and its
history. Terminal input and history are never written to the credential store,
disk, logs, Vercel, or a control plane.

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

The host encrypts its credential map with DPAPI `CurrentUser`, so records are
bound to the non-elevated integration identity. Use the same explicit `-store`
path to retain device authorization across host restarts. The default is a
per-process temporary store removed after clean shutdown. Running terminals
and bounded output history remain memory-only and do not survive host restart.

With `-print-pairing-code`, startup emits the first short-lived code and enables
an attached operator console. Type `pair` plus Enter for each additional browser
or device, or after a code expires. Each fresh code replaces the previous code,
expires after two minutes, and is consumed by the first syntactically valid
attempt, including a wrong attempt. Issuing another code keeps existing device
credentials and terminal sessions intact; it does not restart the agent.

Each request displays its Origin, client-instance ID and verified device
identity. Review those details and type the exact `approve <request-id>` command
shown, or `deny`, within 60 seconds. Bare `y` is no longer accepted: a decision
must identify the current request so delayed input cannot approve another
device. Timeout denies that request while keeping the console available for
`pair`. Another code cannot be issued while approval is pending. Console EOF,
display failure and host shutdown deny pending approvals. Startup refuses this
flag when stdin, stdout or stderr is redirected, using the installed Windows
`GetConsoleMode` API (`golang.org/x/sys/windows` v0.47.0).

The temporary pairing code is onboarding only. Each browser receives its own
credential, valid for slightly under 30 days, and reuses it across terminal
sessions and reconnects without another code. Pair additional devices separately;
do not copy credentials between browsers. Each device still needs Tailscale
access and a client certificate trusted by the configured client CA, including
a browser running on the host itself. Tailscale access does not bypass pairing.

One configured Windows host is supported today. Its endpoint already accepts an
agent identity and multiple credentials; this harness retains its existing
integration identity. Future host types need their own adapters and deployment
identity provisioning, not shared browser secrets. Account identity is separate
from terminal authorization. Each authorized browser may create independent
terminals; an existing session remains bound to its creator's credential and
verified device. This change does not enable shared attachment.

Pairing material remains explicit operator-console output only and must never
be redirected, logged, or captured. Approval prompts contain no credential
secret, proof or password.

Safe commands (run from this directory, with an externally supplied already
trusted certificate) are:

```powershell
go run ./cmd/integration-host -mode serve -listen 127.0.0.1:0 -origin <exact-https-origin> -server-name <certificate-hostname> -cert <existing-cert.pem> -key <existing-key.pem> -client-ca <existing-client-ca.pem> -device-id local-integration-device -store <protected-store-path> -print-pairing-code
Invoke-WebRequest https://<certificate-hostname>/healthz
go run ./cmd/integration-host -mode revoke -store <protected-store-path> -revoke-id <credential-id>
go run ./cmd/integration-host -mode reset -store <protected-store-path>
```

The pairing-code flag is explicit operator-console output only; never redirect
it, log it, or commit it. Do not use the synthetic `httptest` certificates in
the tests for browser integration. Revoke mode writes a local non-secret marker
and also removes the encrypted record; a running host consumes the marker and
calls `Endpoint.RevokeCredential` so active authorizations and sessions close.
Until an already-trusted certificate, client-CA bundle, and approved private
publication mapping are supplied, no real WSS URL exists.

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

## Private session intelligence 1.0 (S03-009)

The optional `/intelligence` WebSocket uses `terminus.intelligence.v1`, the
existing exact HTTPS Origin and private client-certificate resolver, and a
separate HMAC domain over a ten-second single-use challenge. It never opens a
terminal or changes `/terminal` protocol 0.2. New pairing credentials carry a
DPAPI-protected device binding. A legacy credential is pinned atomically only
after successful terminal HMAC authentication; intelligence rejects an unbound
or differently bound credential. Revocation and expiry close intelligence too.

The agent reads these server-only environment variable names:

- `TERMINUS_INTELLIGENCE_DATABASE_URL`: private PostgreSQL connection configuration
  for the least-privileged `terminus_intelligence_app` role.
- `TERMINUS_INTELLIGENCE_ADMIN_CREDENTIAL_IDS`: comma-separated credential UUID
  allowlist for aggregate-only administration.
- `TERMINUS_INTELLIGENCE_OLLAMA_URL`: optional explicit loopback HTTP origin.
- `TERMINUS_INTELLIGENCE_MODEL`: installed local model identifier.

Run the Session 04 database migrations and grants explicitly before startup.
The host checks schema availability but never migrates a production database.
Unset or unavailable database configuration leaves terminal operation intact;
intelligence returns unavailable. No configuration values are logged.

The service implements the contract's session/privacy, command/history,
recommendation, account, usage/export/delete, billing and aggregate-admin RPCs.
Collection defaults off. Only explicit composer submissions may be recorded;
all arguments are discarded into reviewed command templates or `[redacted
command]`. Output and keyboard streams are never captured. Status is always
`submitted`; exit status and execution duration remain unknown. Disabling history
stops collection; deletion clears persisted history. Queries exclude expired
rows immediately and bounded maintenance removes expired records. Guest deletion
clears guest content and rotates the security session. Login associates only the
caller's eligible guest history, and logout rotates to a separate guest owner.
Export returns at most 50 rows per page with an owner-checked UUID cursor and
`nextCursor`; clients combine pages only while the security session ID is stable.
RPC response envelopes have a 60 KiB hard bound; no successful export silently
truncates history.

Local account passwords use algorithm v1: domain-separated SHA-256 prehash,
unpadded standard base64, then bcrypt cost 12. This preserves the whole permitted
1024-byte password without bcrypt's 72-byte limit. Account email is an identifier,
not a verified email claim. No email sending or commercial onboarding exists.

RAG retrieves reviewed source-attributed catalog templates locally and uses only
consented current-owner history for local ranking. Optional Ollama receives only
catalog documents, never user query/history. Model text can change an explanation,
never the authoritative command or source URL. Catalog fallback is explicitly
reported. Monthly token accounting uses provider counts and transactional capacity
reservations; stable paired-device quota ownership survives guest deletion,
login and logout. Sessions counts represent current unexpired associations;
terminal time is bounded client-observed connection time, not shell duration.
Commercial billing is disabled. Admin responses contain aggregate numbers only.

For local Chrome verification only, `-web-upstream http://127.0.0.1:<port>` serves
Next assets through the existing trusted mTLS listener. It validates an explicit
loopback HTTP origin; `/terminal`, `/intelligence` and `/healthz` retain direct
handlers. The default has no proxy. Existing `-listen`, `-origin`, `-server-name`,
`-cert`, `-key`, `-client-ca`, `-device-id` and explicit protected `-store` inputs
remain required. This helper does not deploy Vercel assets or alter Tailscale.

Real database tests require `TERMINUS_INTELLIGENCE_TEST_DATABASE_URL` pointed at
an isolated disposable database with Session 04 migrations and grants. Then run
`go test -count=1 ./...` and `go vet ./...`. Model response tests use an explicitly
labelled local HTTP double with real PostgreSQL accounting. These tests alone
are not production Chrome, actual Ollama generation, or deployment evidence.

Additional API sources inspected for this task:

- Installed `github.com/jackc/pgx/v5@v5.7.6/stdlib/sql.go` documents `sql.Open("pgx", ...)`
  and positional parameters; [pgx stdlib](https://pkg.go.dev/github.com/jackc/pgx/v5@v5.7.6/stdlib).
- Installed `golang.org/x/crypto@v0.49.0/bcrypt/bcrypt.go` documents hashing,
  comparison and the 72-byte bound; [bcrypt](https://pkg.go.dev/golang.org/x/crypto@v0.49.0/bcrypt).
- [Ollama generate API](https://docs.ollama.com/api/generate) documents non-streaming
  generation, `done`, `prompt_eval_count` and `eval_count`.

## Terminal API sources

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
