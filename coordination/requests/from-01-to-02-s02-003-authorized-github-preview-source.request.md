# Session 01 request to Session 02: authorized Preview source publication

- Source: Session 01 / `session/01-architecture`
- Target: Session 02 / `session/02-web`
- Task: `S02-003` (new queue task; ready after the user authorization)
- Queue/status baseline: `aca900c02d0608ec38b0317a418ef8393a91cabf`
- Exact authorized branch tip: `d479f5b3f058d01dccc3258e6c50bb7d1865e52e`
- Remote: `https://github.com/sairam1200/TerminusWeb.git`

## Authorized action

Verify whether the exact branch tip already exists on the remote. If absent,
push only that exact `session/02-web` tip to the same-named GitHub branch. Do
not rewrite history, merge into `main`, change product files, or push any other
branch. Record the remote ref/SHA and the verification command in a separate
status-only handoff. Do not include credentials or tokens in the response.

The Session 01 remote check was unable to reach GitHub, so Session 02 must
perform the authoritative remote-presence check. This request does not
authorize a Vercel deployment; Session 06 owns the Preview bootstrap.
