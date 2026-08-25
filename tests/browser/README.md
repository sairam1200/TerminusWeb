# Browser/PWA verification harness

The default target is a local PWA-shaped fixture with an in-memory terminal adapter. Every result from it is labelled `labelled-test-double`; it is not proof of a real WebSocket, ConPTY, Tailscale, Vercel, or device path.

```powershell
npm ci
npx playwright install chromium
npm test
```

The suite covers desktop and iPhone-sized layout, terminal keyboard input, the mobile key bar, resize propagation, reconnect and focus restoration, PWA manifest metadata, CSP, exact-destination acceptance, and unapproved-origin rejection.

Real-browser mode is fail-closed. It requires an HTTPS base URL, an immutable candidate SHA, and a Session 06-owned profile module that exports `metadata`, `selectors`, `approvedDestination`, `rejectedDestination`, and `induceDisconnect(page)`. The profile metadata must declare `evidenceClass: 'real-browser'` and the selected SHA.

```powershell
$env:TERMINUS_BROWSER_TARGET = 'real'
$env:TERMINUS_BROWSER_BASE_URL = 'https://preview.example.invalid'
$env:TERMINUS_BROWSER_PROFILE_MODULE = 'E:\path\to\real-browser-profile.mjs'
$env:TERMINUS_BROWSER_CANDIDATE_SHA = '<40 hexadecimal Git commit characters>'
npm run test:real
```

Do not put pairing material or reusable credentials in the profile module or command history. Supply runtime secrets through the authorized CI secret store or ephemeral process environment.
