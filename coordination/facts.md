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
