# S02-011 browser suspension recovery

Inputs: reviewed S02-010 product `cc87282`, Session01 requirements `b5d1ddf`
and retry-window clarification `8d1dcf0`. No protocol version change.

## Confirmed regression

Before modifying runtime source, ran:

`npx vitest run terminal/protocolTerminalAdapter.test.ts -t 'reopens the same session after a transport error'`

FAIL: expected `detached`, actual `error`. The old socket error emitted a fatal
protocol error, while subsequent parameterless foreground retry discarded the
known locator and opened a fresh shell. The test passes after the fix.

## Changes

- Transport release, browser hiding/closure and liveness expiry preserve the
  locator and close the socket without a fatal protocol frame. Reconnect retains
  the exact session ID. Actual protocol violations still fail closed.
- A ten-second pre-open timeout bounds a native WebSocket that never emits
  open/error; it is cleared before pairing approval and fenced against replacement.
- Foreground recovery uses eight attempts with delays 0.5/1/2/4/8/16/16/16
  seconds (last at 63.5 seconds plus operation time). The final attempt extends
  beyond the server's 45-second liveness check with up-to-15-second polling.
  Generic busy/unknown reopen results do not disclose ownership or bypass it.
  Authentication failure, hidden/offline state, explicit stop and unmount stop
  retries. Exhausted episodes are not rearmed by repeated lifecycle events.
- Disconnect/Detach leave the host shell running; End Terminal is explicit.
  Failed End transport retains its locator/recent entry and shows safe guidance.
  New Session remains close-and-replace and explains that effect.
- Recent-session choices are explicit, canonical, globally bounded to twenty
  records and scoped to exact configured endpoint/mode/origin plus credential ID.
  Only locators, timestamps and scope identifiers are stored; no terminal data,
  labels or credential secrets. Denied/corrupt storage is optional, and successful
  end/replacement removes the entry. Root pages do not auto-resume.

## Final commands

From `apps/web`:

- `npm test`: PASS, 18 files / 150 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, no warnings after removing the temporary UI fixture.
- `npm run build`: PASS, Next.js 16.3.3 / ten static pages. Process-only public
  configuration set `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`,
  `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`, `NEXT_PUBLIC_TERMINUS_CONNECT_MODE` to the
  existing production private endpoint/origin/mode, with local-profile variables
  unset. No environment file changed.
- `npx prettier --check README.md protocol/recentSessions.ts protocol/recentSessions.test.ts terminal/browserRecovery.ts terminal/browserRecovery.test.ts terminal/adapter.ts terminal/protocolTerminalAdapter.ts terminal/protocolTerminalAdapter.test.ts components/TerminalShell.tsx components/TerminalShell.test.tsx`: PASS.
- `git diff --check`: PASS.

New deterministic cases include closing-socket input, never-opened transport,
old timeout cancellation, independent retry budget/exhaustion, hidden in-flight
reconnect/late success, offline/authentication failure, optional metadata scope,
end-send failure and acknowledged metadata removal, explicit recent selection
after failed New Session, and no root auto-open. Existing malformed, replay,
history-offset, backpressure and stale-generation checks remain passing.

## Browser observation boundary

Used installed `@playwright/cli` 0.1.19, through its `playwright-cli.js` entry,
isolated session `s02-recovery`. Commands included `open about:blank`, fixture
`run-code --filename`, `snapshot`, `click`/`fill` using observed references,
`resize 1280 800`, `resize 390 844`, `eval` for viewport/document width,
`screenshot`, `console error`, and `close`.

All page assets were routed to a temporary Next server bound to
`127.0.0.1:4787`; a synthetic WebSocket class handled the protocol frames without
constructing any native socket. No actual private endpoint was contacted. The
fixture supplies authentication success, so this is UI evidence, not agent or
TLS evidence. The server and browser were stopped, and the helper file removed.

Observed English desktop and Swedish phone-sized connected controls, including
the New Session effect and separate End action. Document width equalled viewport
width (1280 and 390 respectively); the inspected mobile screenshot showed readable
controls without horizontal overflow. Disconnect followed by root navigation
offered a recent locator without automatic connection. Clicking that choice
returned Connected at the same fragment; End returned Disconnected with no
fragment or recent entry in the snapshot. Browser console had zero errors and
warnings. This visual run preceded final nonvisual timeout/retry refinements;
Session06 independently checks the immutable final product.

Initial fixture attempts encountered unsupported CLI `URL` global and an invalid
static-output assumption; switching to bounded `route.fetch` against the temporary
Next server resolved them. One optional final DOM-eval command had a shell-quoting
error; the saved final snapshot established the end result instead. No failures
were presented as passing checks.

## Limitations

Physical iPhone Safari, real multi-device/Tailscale traffic and integrated host
process retention are not maker-verified. Host expiry/revocation, process exit,
resource/containment failure and shutdown still end sessions. Output stays bounded
in volatile host memory; there is no restart-persistent terminal archive. Other
tabs sharing a credential can collectively reach host throttles. No production
deployment, host restart, TLS/network policy or account-authorization change.
