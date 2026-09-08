# Architecture Baseline

Status: approved planning baseline; implementation details remain contract-gated.

## Personal web prototype

```text
iPhone Safari / installed PWA
    |
    | loads static web assets
    v
Vercel Hobby (personal, non-commercial prototype)

iPhone browser
    |
    | direct authenticated WSS over the private tailnet
    v
Tailscale-private HTTPS/WSS endpoint
    |
    | loopback origin
    v
Windows agent -> ConPTY -> user-owned shell
```

The Vercel request path and the terminal data path are separate. Vercel must not relay terminal frames.

## Host access from independently authorized devices

The personal prototype supports several authorized browsers connecting to one
configured host. The host owns its credential store and terminal processes;
each browser receives a separate authorization credential. Pairing another
browser must neither replace earlier credentials nor stop their sessions.
Pairing is onboarding, not an operation repeated for each terminal session.
This clarifies existing protocol 0.2 behavior without changing its wire format.

| Concept | Current implementation and boundary |
| --- | --- |
| Host | Agent instance, its configured private TLS endpoint, protected credential store and PTY adapter. `hello_ack.agentId` is metadata, not proof of authorization. |
| Device/browser | Verified client-certificate identity plus a separately paired browser credential. Two browsers on one device may have different credentials. `clientInstanceId` alone is not trusted identity. |
| Authorization | A host-local credential record containing ID, secret, expiry and device identity. The host validates fresh HMAC proof and device binding before opening a terminal. |
| User/account | The local host operator approves onboarding. Optional intelligence accounts and future control-plane accounts do not automatically grant terminal access. No new terminal account service is introduced. |
| Terminal session | Host-owned running PTY, with a credential and source-device owner for access checks, one attached WebSocket, activity/lifecycle state and bounded volatile history. |

On each additional browser, use a fresh short-lived code issued by the host,
then approve that exact browser request on the host. A successful ceremony
creates a new independent credential; it never copies another browser's key.
The existing 128-bit code, 120-second deadline, single-use consumption,
60-second approval deadline, rate limits and generic `PAIRING_FAILED` response
remain unchanged. The host's local onboarding console must support another
ceremony after expiration or denial without restarting the host or allowing a
late approval to approve a different request.

Each browser stores its non-extractable HMAC key, credential ID and expiry in
origin-bound IndexedDB. Raw credential bytes are transient during import;
future connections send challenge proofs rather than the secret. The host
protects its credential map using Windows DPAPI CurrentUser. An explicit
stable `-store` path preserves credentials across restart; the integration
harness default remains deliberately temporary. Neither option persists
terminal processes or history across host restart. Credentials expire within
30 days; renewal currently means fresh operator-approved onboarding, not
automatic indefinite refresh. Local removal of browser data is not host-side
revocation. Host revocation deletes that credential and closes its active and
detached sessions, leaving independently authorized devices unaffected.

The host's own browser follows the same TLS, pairing and authentication checks.
Tailscale network membership alone grants no terminal permission. The current
private publication uses raw TCP forwarding to loopback TLS with mandatory
client certificates, exact HTTPS Origin and `terminus.v0_2`. Each new device
also needs its own trusted client identity. Vercel serves assets only; terminal
and intelligence WebSockets connect directly to the configured private agent.
The production terminal endpoint remains
`wss://sai.tailf8dcea.ts.net/terminal`.

Requirement A is independent sessions: laptop session A, phone session B and
host-browser session C can coexist on the same host. Requirement B, sharing
control of one running session across credentials, is deferred. Existing
credential/source-device ownership checks and uniform reopen rejection remain
in place, including when another authorized device knows the session locator.
A later shared-session design must settle input ownership, resize authority,
attachment concurrency, revocation and history permissions before implementation.

This change does not introduce a multi-host registry. Browser persistence has
one active credential per web origin and connection profiles select local or
private transport, not independent host accounts. A future multi-host selector
requires approved host-scoped credential storage and legacy migration, stable
host identity and an explicit endpoint allowlist/CSP policy. It must not derive
trust from a user-supplied URL or agent ID. The authorization concepts are
platform-neutral; Linux or mobile hosting requires a separate PTY adapter and
protected credential-store implementation. Those agents are not implemented.
Optional device labels, created/last-used timestamps and account associations
can be added later without treating them as authentication proof. Existing
credential IDs and selective local revocation provide the current management
boundary; no remote device-management API is added.

## Future commercial control plane

```text
Web/PWA -------- HTTPS --------> Control plane
  |                                 |-- identity
  |                                 |-- tenants/RBAC
  |                                 |-- host registry
  |                                 |-- quota leases
  |                                 |-- billing state
  |                                 `-- metadata-only audit
  |
  `------ encrypted WSS over Tailscale ------> Windows agent
```

The control plane may authorize a session but cannot decrypt its terminal stream.

## Deployable boundaries

- `apps/web`: Next.js/TypeScript PWA and terminal UI.
- `apps/windows-agent`: Go Windows service/application, ConPTY, private WSS endpoint, pairing, and process containment.
- `services/control-plane`: future Go API for identity, RBAC, leases, billing, and audit metadata.
- `packages/protocol`: source-controlled wire contract shared by implementations.
- `packages/security`: threat model, pairing/session security contract, and test vectors; no private credentials.
- `infrastructure/tailscale`: proposed private policy and verification procedures only; live changes require authorization.
- `tests`: independent browser, integration, protocol, abuse, and security verification.

## First vertical slice

The first integration target is deliberately narrow:

1. Load the PWA from a Vercel preview.
2. Pair one browser with one Windows agent.
3. Connect directly through a Tailscale-private `wss://` endpoint.
4. Open one independent non-elevated PowerShell session per authenticated
   browser tab through ConPTY, without a fixed protocol or application-policy
   limit on the number of concurrent sessions across the agent.
5. Exchange input, output, resize, heartbeat, detach, reopen/history, and close
   frames.
6. Reconnect after foreground/background or network interruption without exposing a public port.
7. Keep one stable short session ID per page. Reloading
   `#/s/xxxx-xxxx-xxxx` reopens that credential-owned running session and replays
   bounded history from volatile agent memory; the fragment is never sent to
   Vercel. The page requests a different ID only through **New Session**.

The agent does not reject `open_session` solely because some numeric count of
other sessions is active or detached. It attempts terminal creation for every
valid request unless shutdown has begun; a genuine adapter, ConPTY, or system
resource failure uses the existing `SESSION_OPEN_FAILED` result and cleans up
any partially created resources. Each accepted tab retains its own connection,
session identifier, ConPTY process, resize state, heartbeat, reconnect state,
and cleanup lifecycle. Protocol 0.1 still carries at most one terminal per
WebSocket and does not multiplex terminals. Protocol 0.2 retains at most
262,144 terminal-output bytes per running session and 16,777,216 history bytes
across the Windows agent. It
does not persist terminal plaintext in browser storage, on disk, at Vercel, or
in a control plane. Explicit close/New Session, credential expiry or
revocation, process exit, unrecoverable failure, and agent shutdown remove that
session and its retained history.

Subscriptions, advertising, owners, multi-tenancy, and super-administration are outside this first vertical slice.

## Approved private session intelligence

The user approved an optional private intelligence capability on 2026-09-07.
`packages/protocol/INTELLIGENCE-1.0.md` and its addenda define a separate,
credential-authenticated `/intelligence` WebSocket on the same private agent.
Terminal protocol 0.2 remains unchanged. Vercel and the metadata control plane
remain outside both terminal and private command-history data paths.

Only explicit command-composer submissions reduced to reviewed safe templates
may be retained in private PostgreSQL after opt-in. Raw xterm input/output,
arbitrary arguments, clipboard and shell environment remain excluded. The
privacy exception is defined in `packages/security/INTELLIGENCE-PRIVACY-1.0.md`.
Guest/account history ownership is separate from the persistent paired-device
AI quota principal, so logout or guest deletion cannot reset the allowance.
Curated local retrieval works without a model; optional local model explanations
must report actual provider usage and cannot choose executable commands.

This extends the personal prototype with passive billing/accounting foundations;
it does not activate paid subscriptions, public onboarding or advertisements.
