# S02-002 browser protocol integration evidence

Status: deterministic owner checks pass. The final live Chrome
authentication/reconnect action is pending the required action-time
confirmation and is not claimed by this report.

## Exact inputs

- Authoritative queue: `3428aaa35ceca06fc21c41a001a370a463235aa5`;
  S02-002 is `ready`.
- Web baseline: `bf7ca71b437907e7d25251e54d59355440797ad4`.
- Protocol/security source consumed by the web client:
  `910b69e24f464bb3e89152f3e5881beb9b706b76`.
- Windows-agent product:
  `0446e685489d2e9d09715d6cc5ba011a5471a540`; the current runtime was
  restarted from its status-bearing branch and was reported at capture time as
  non-elevated PID 6932, listening only on `127.0.0.1:8443`.
- Private endpoint response:
  `c092189:coordination/requests/from-03-to-02-s03-004-endpoint-ready-20260830.response.md`.
- Private-path reviews:
  `e4a362922f2487b685d06e27dd02bd2f7b52e656` and
  `e823add5f5495e9f66339dfcd3f81731d3e3cfd9`.
- Frozen browser Origin: `https://terminus-web.vercel.app`.
- Private destination: `wss://sai.tailf8dcea.ts.net/terminal`.
- WebSocket subprotocol: `terminus.v0_1`.

No certificate, private key, PFX password, pairing code, credential, proof,
resume grant, terminal input, or terminal output is recorded here.

## Deterministic adapter result

The cumulative adapter suite consumes the canonical protocol 0.1 fixtures and
already covers connect, authentication, open, input/output, resize, heartbeat,
detach/resume, close, exact destination, subprotocol, malformed/binary/replayed
frames, illegal state, grant expiry, and backpressure rejection.

This task adds a focused reload regression. It starts with an empty IndexedDB
credential store, performs one synthetic pairing exchange, and persists only a
non-extractable HMAC key plus bounded metadata. It then constructs a fresh
store and adapter against the same IndexedDB factory, modeling a later page
load in the same browser profile. The second connection:

- includes the existing credential identifier in `hello`;
- answers the authentication challenge with the stored non-extractable key;
- does not enter the `pairing` state; and
- emits no second `pairing_request`.

Together with the existing detach/resume test, this proves browser application
behavior for silent stored-credential authentication and resume after the
one-time pairing step. Client-certificate selection is controlled by the
browser/OS TLS stack and cannot be forced or asserted by web JavaScript.

## Commands and results

Run from `apps/web` on Windows:

- `npx vitest run terminal/protocolTerminalAdapter.test.ts --reporter=verbose`:
  PASS, 11/11.
- `npm test`: PASS, 7 files and 42/42 tests. The first sandboxed full attempt
  failed before discovery with Windows `spawn EPERM`; the unchanged
  authorized rerun outside that restriction passed.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npx prettier --check terminal/protocolTerminalAdapter.test.ts`: PASS.
- `npm run build` with
  `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN=https://terminus-web.vercel.app` and
  `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT=wss://sai.tailf8dcea.ts.net/terminal`:
  PASS after the same sandbox-only worker `spawn EPERM` was rerun unchanged
  outside that restriction. Next.js 16.3.3 emitted static routes `/`,
  `/_not-found`, and `/manifest.webmanifest`.
- Generated `.next/routes-manifest.json`: exact CSP
  `connect-src 'self' wss://sai.tailf8dcea.ts.net`.
- Generated `.next/server/app/index.html` SHA-256:
  `7DFD113B5A1351356BA47204954B6CB21A3E8420FF8BECEE4F9A692CD317DE5C`.
- `git diff --check`: PASS.

Dependency names and versions were checked against `package-lock.json`:
Next.js 16.3.3, xterm 6.0.0, TypeScript 6.0.3, and Vitest 4.1.11.

## Real-browser and real-path boundary

Read-only Chrome inspection used the existing user profile:

- an already-open `https://sai.tailf8dcea.ts.net/healthz` tab was present,
  consistent with the separately recorded successful reuse of the installed
  ClientAuth identity;
- `https://terminus-web.vercel.app/` loaded the protocol client in the
  disconnected state, displayed the exact private hostname, and produced zero
  browser-console errors or warnings;
- at 390 by 844 CSS pixels it rendered portrait, reported no horizontal
  overflow, and retained disabled terminal controls before connection.

The Session 05 exact-commit real-path evidence independently records valid
installed ClientAuth success twice, exact Origin plus subprotocol WSS upgrade,
and denial of no/unrelated certificate, wrong Origin, and wrong subprotocol.
Those checks stopped before application frames and are not presented as a full
browser authentication or terminal flow.

Clicking **Connect privately** would send an authentication proof to the
private agent and open a real ConPTY session. That sensitive live action is
held pending immediate confirmation. Therefore this report does **not** claim:

- a current live authenticated Chrome terminal connection;
- silent certificate selection plus stored-credential reuse across two live
  connections;
- a physical Android or iPhone Chrome/Firefox result; or
- that the exact cumulative web product is deployed.

The currently deployed page is useful real-browser layout and endpoint
evidence, but a production URL alone is not terminal-path proof. Session 06
must independently reproduce the full live flow against the exact integrated
candidate before release.
