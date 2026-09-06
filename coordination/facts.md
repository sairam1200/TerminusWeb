# Verified Facts and Approved Decisions

Session 01 owns this file. Other sessions submit proposed corrections through `coordination/requests/`.

## Approved baseline

- The first product is a personal, non-commercial web/PWA prototype hosted on Vercel Hobby.
- The browser connects directly to the Windows agent over a Tailscale-private WSS path.
- Vercel and the future control plane do not proxy or store terminal streams.
- The Windows agent runs non-elevated by default and uses ConPTY for the first shell implementation.
- Tailscale Funnel and public terminal exposure are out of scope.
- Commercial roles, quotas, billing, and ads follow only after the private vertical slice is verified and commercial hosting is selected.

## Unresolved contracts

- Exact protocol serialization and cryptographic construction.
- Browser private-network compatibility matrix for the chosen Tailscale Serve endpoint.
- Windows packaging, code-signing, and update mechanism.
- Commercial Tailscale integration/licensing model.

## Authorized private integration bootstrap (2026-08-26)

- The user authorized a Preview-only deployment of the exact Session 02 branch
  tip `d479f5b3f058d01dccc3258e6c50bb7d1865e52e` to GitHub/Vercel, with
  `apps/web` as the Vercel Root Directory. Production promotion, `main`
  integration, public exposure, DNS changes, and final release remain
  unauthorized.
- The user authorized one personal-test private raw-TCP Serve mapping for
  `sai.tailf8dcea.ts.net:443` to a Session 03 loopback port, with Funnel,
  HTTPS/TLS-terminating Serve, LAN/public binds, SSH/RDP, grant broadening,
  and terminal proxying through Vercel explicitly disallowed.
- This authorization freezes `sai.tailf8dcea.ts.net` as the target hostname for
  this run. Session 06 reported a conflicting `sai.tail98bed6.ts.net`
  observation; that conflict must be rechecked in the live environment and
  must not be silently substituted.
- Private certificate/key files and PFX passwords remain out-of-band. The
  browser leaf must have explicit Client Authentication EKU
  `1.3.6.1.5.5.7.3.2` before live verification. Session 03 owns host startup,
  Session 05 owns Serve/private-path controls, and Session 06 owns independent
  verification.
- Session 02 confirmed the exact branch tip on GitHub, but Vercel's first
  deployment of the newly created empty project was automatically classified
  as Production and was deleted. The current authorization does not permit a
  temporary Production-classified bootstrap; an already-initialized Preview
  project or a separately authorized platform decision is required before an
  exact HTTPS Origin can be frozen.

## No fixed browser-tab session cap decision (2026-08-29; supersedes 2026-08-27)

- The user requires each authenticated Chrome tab to own an independent
  non-elevated PowerShell/ConPTY session.
- Protocol 0.1 and the Windows agent application policy impose no fixed numeric
  maximum on concurrent terminal sessions across connections. A valid
  authenticated request is not rejected solely because other sessions exist;
  the agent attempts terminal creation unless shutdown has begun.
- Each WebSocket still carries at most one session. Protocol 0.1 does not add
  multiplexing, new frames, fields, or error codes; the existing
  `SESSION_OPEN_FAILED` result is preserved for genuine adapter `Open`, ConPTY,
  system resource, or shutdown failures.
- Open, detached, and resuming sessions remain independently accounted for
  until deterministic cleanup completes, but accounting does not reserve a
  fixed-capacity slot. Per-session backpressure bounds, pairing, mTLS,
  authentication, authorization, exact Origin validation, expiry, credential
  revocation, private listener scope, and Funnel-disabled requirements remain
  unchanged.

## Remembered private session decision (2026-08-30)

- The user requires each terminal page to keep one stable, simple session ID
  across reloads and network reconnects. A page changes identity only after its
  explicit **New Session** action succeeds.
- Protocol 0.2 uses a cryptographically random 60-bit Crockford Base32 locator
  rendered as `xxxx-xxxx-xxxx`. The ID is metadata, not a secret or bearer token;
  a successfully authenticated, unexpired originating credential is still
  required to reopen it.
- The browser represents the ID only in the URL fragment
  `#/s/xxxx-xxxx-xxxx`, so it is not sent in an HTTP request to Vercel. Browser
  persistence contains credential material and non-secret session metadata as
  already contracted, but never terminal plaintext or replay chunks.
- The Windows agent owns a bounded 262,144-byte volatile output-history ring
  per running session and a 16,777,216-byte agent-wide history budget. Reopen
  replays an offset-labelled snapshot before live
  output. Truncation is explicit; output ordering and concurrent attachment are
  fail-closed. History is never written to disk, logs, Vercel, a service worker,
  analytics, crash reporting, or the control plane.
- Network loss and per-connection authorization expiry detach rather than
  destroy a running session. Explicit New Session/close, credential expiry or
  revocation, process exit, unrecoverable resource/backpressure failure, and
  agent shutdown/restart terminate the session and discard its retained
  history.
- Version 0.2 preserves one terminal per authenticated WebSocket and the
  no-fixed-count-cap decision. It replaces version 0.1's 120-second one-time
  resume grant with authenticated same-credential reopen and therefore is a
  breaking, coordinated consumer update.

## Repository recovery on 2026-09-06

- The user explicitly authorized local consolidation of all branches and resolution of implementation/UI conflicts. S01-006 records this recovery scope; the original S01-002/S01-003 verified-release gates are not bypassed or marked complete.
- All preserved local branch tips and freshly fetched origin tips are ancestors of the recovery assembly. Newer protocol 0.2, remembered-session agent and xterm UI implementations supersede the older temporary merge resolutions.
- The recovery uses the Session 02 and Session 03 owners for implementation repairs and Session 06 for independent local review/browser verification. Local simulation and deterministic checks do not establish live private-device or physical-mobile compatibility.
- Existing S05-008-RESOURCE-001 replay-copy memory accounting remains release-blocking. No remote push, deployment or live network/agent change was performed in this recovery.
