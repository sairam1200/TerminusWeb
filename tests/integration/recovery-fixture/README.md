# Independent browser/host recovery fixture

`run.ps1` archives an immutable agent commit into an ignored Session06 snapshot,
adds this test-only fixture inside its internal import boundary, builds/vets it,
and verifies the actual TypeScript client against the actual Go endpoint.
The selected web checkout must exactly match its declared product before/after.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/integration/recovery-fixture/run.ps1 -AgentCommit <exact-sha> -WebCommit <exact-sha> -WebRoot <absolute-apps/web-path> -BrowserTools E:/terminus/tests/browser
```

The fixture uses `httptest.NewTLSServer` on an ephemeral loopback port. Node's
HTTPS/WebSocket clients trust only its disposable public test certificate via
the `ca` option; TLS verification stays enabled, and no global certificate or
trust setting changes. Device resolution, credential storage and PTY are
explicit synthetic boundaries. No PowerShell, ConPTY or real command is launched.
The fixture's additional emit/state controls are never added to product routes.

The unchanged client TypeScript is compiled in memory through the installed
TypeScript `transpileModule` API. The WebSocket client is Playwright 1.62.1's
installed `playwright-core/lib/utilsBundle.js` `ws` export (confirmed from its
local implementation), avoiding a new dependency installation. The normal
local-mode endpoint/Origin policy is exercised. The declared synthetic page
Origin is `https://127.0.0.1:4192`; no page listener is required there.

The check creates one synthetic session, receives synthetic output, invokes the
browser error callback on its writable real TLS socket, waits 2.2 seconds,
emits additional output, and reconnects. It requires the same locator, exactly
one unclosed PTY, no fatal client frame, and ordered replay. It then releases the
transport and creates a fresh client adapter with the same credential and an
explicit locator, proving document replacement can recover the same session.
The credential store here is memory-backed; browser recent-session metadata
and IndexedDB persistence require separate tests.

Output reports only booleans/counts and classifications. No actual terminal
content, pairing code or production credential is available to the fixture.
Its output string and deterministic credential are test-only values, and the
synthetic credential is never printed. Child startup and recovery waits are
bounded; the child is stopped after verification. Generated source/build files
remain ignored under `tmp/`. Passing this fixture does not prove Tailscale,
browser-native TLS/mTLS, Safari, physical-device lifecycle behavior or live-host
restart recovery.
