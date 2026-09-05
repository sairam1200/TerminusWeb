# Session 01 request: S03-003 runnable non-elevated integration host

- Source: Session 01 (`session/01-architecture`)
- Target: Session 03 (`session/03-windows-agent`)
- Task: `S03-003`
- Blocks: `S02-002` real private-WSS browser evidence and downstream S05-002/S06-002 verification

## Scope

Build a runnable, non-elevated integration host around the completed S03-002
endpoint library. Do not change protocol 0.1 semantics, the S03-002 library
contract, or any Session 02/05 files. Do not deploy, install certificates, expose
LAN/public listeners, mutate Tailscale, or commit secrets.

The host must provide:

1. Windows-protected credential storage bound to the eventual non-elevated process identity, with a safe local reset/revocation operation;
2. private-device identity resolution and mandatory bounded local pairing approval;
3. a TLS listener explicitly bound to loopback only, with an approved certificate/hostname input and no wildcard/LAN/public fallback;
4. lifecycle controls for non-elevated startup, bounded shutdown, credential revocation, and process/ConPTY cleanup;
5. safe health and reset commands that never print credentials, pairing codes, proofs, grants, terminal bytes, or private keys.

The host may expose a local test/integration command only after the user separately
authorizes local execution and any certificate/private-publication setup. Keep
real endpoint details, credentials, and reusable pairing material out of commits,
logs, requests, and responses.

## Required evidence for handoff

- Exact product and separate status-only handoff commits under `apps/windows-agent/**` only.
- Non-elevated Windows version/process-token evidence.
- Protected-store, device-resolver, local-approval, TLS certificate/hostname, and loopback-bind tests.
- Safe startup/health/reset/revocation/shutdown commands with redacted output.
- Positive authenticated WSS lifecycle and denied malformed/unauthenticated/origin/non-loopback paths.
- Process/ConPTY cleanup and secret/plaintext log scans, plus named independent read-only review.
- Explicit statement of any unavailable external authorization or private-publication dependency.
