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
