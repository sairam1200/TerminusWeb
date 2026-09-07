# S02-008 unavailable connection guidance

Owner: Session 02, `/root/intelligence_web`, isolated `session/02-web` worktree.
Authorization/task: committed Session 01 queue `0df4a5b`, dependency S02-007
product `cd6a1ef32e40f41ebada2b5a36cdcbefb90346ea`, independently reviewed by `/root`.

## Observed problem and correction

Root's Chrome check found localhost staging advertising the earlier layout-only
local profile on port 4176. No backend listener existed there. WebSocket failure
was displayed as a PowerShell creation failure because the adapter reused the
existing `SESSION_OPEN_FAILED` code for local transport failure.

The adapter now records a separate browser-only `transport` cause on socket
construction/error/unexpected-close paths. It clears that cause on retry and
ignores stale-socket errors. The UI gives truthful secure-connection guidance
without guessing whether networking, the agent or browser certificate trust
caused the failure. Genuine server shell-open failures retain their bilingual
PowerShell message. No new field/code is sent on the protocol.

A pre-upgrade socket close now rejects the pending connect promise instead of
leaving it pending. Configured-origin mismatch pages provide links constructed
only from validated profiles; links do not carry the current session fragment,
queries or credentials. Invalid origins produce no navigation link.

## Checks

- `npm test`: PASS, 16 files, 123 tests. Added socket and UI doubles cover
  pre-upgrade error/close, constructor failure, settled connect promise, retry
  cause reset, stale old-socket error, transport versus genuine shell guidance,
  Swedish guidance, safe exact origin and unsafe-origin rejection.
- `npm run lint`: PASS without warnings.
- `npm run typecheck`: PASS. Final production build repeats TypeScript checking.
- `npm run build`: PASS, Next.js 16.3.3, ten generated static pages.
- Targeted Prettier and `git diff --check`: PASS.
- No package dependency changed. Existing installed WebSocket port interface,
  `resolveProfiles`/endpoint policy, adapter and React APIs were reused.

The final build uses only process-scoped public private-profile configuration:
`NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT=wss://sai.tailf8dcea.ts.net/terminal`,
`NEXT_PUBLIC_TERMINUS_WEB_ORIGIN=https://sai.tailf8dcea.ts.net`, and
`NEXT_PUBLIC_TERMINUS_CONNECT_MODE=private`. Both `NEXT_PUBLIC_TERMINUS_LOCAL_*`
values were unset for this build. No environment file or production setting changed.

Root authorized stopping only verified Next staging PID 6456. Path/PID/listener
guards passed; the rebuilt helper restarted hidden as PID 28976 using the same
Next `start --hostname 127.0.0.1 --port 3000` arguments and existing staging log
paths. Listener verification: only `127.0.0.1:3000`; HTTP 200. The served payload
contains the private endpoint/origin and excludes the absent local 4176 fixture.
No private agent, TLS, certificate, Tailscale or database mutation was performed.

## Limits and next gate

An existing browser may still have the former local profile in its saved
connection preferences. Persistence semantics and user browser data were left
unchanged as instructed; root guides the browser to the correct private origin.
No local backend availability is claimed. The earlier local profile was a layout
fixture and must not be interpreted as a working local terminal service.

Root owns Chrome/private operator-host verification and independent exact-product
review. Socket/component doubles and HTTP asset availability do not establish
real terminal connectivity. Product SHA and reviewer outcome belong in the
separate Session 02 status handoff.
