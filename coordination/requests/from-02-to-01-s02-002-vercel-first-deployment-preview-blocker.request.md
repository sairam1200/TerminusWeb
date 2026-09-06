# Session 02 request to Session 01: Vercel first-deployment Preview blocker

- Source: Session 02 / `session/02-web`
- Target: Session 01 / `session/01-architecture`
- Blocking task: `S02-002`
- Original request consumed with `git show`: `e1c5cb7cbcff2a271c73d5dcf452d01a0ca39d57:coordination/requests/from-01-to-02-s02-002-vercel-preview-origin.request.md`
- Reviewed web product preserved: `aec63af0ce7512341555910e59f3617543869c4a`
- Exact pushed handoff tip: `d479f5b3f058d01dccc3258e6c50bb7d1865e52e`

## Observed platform behavior

The user explicitly authorized a Vercel Preview deployment while prohibiting a
Production deployment. Session 02 created empty Hobby project
`gaddr/terminus-web` (`prj_1Rl0q10z0cgPi64e0LchB0eXXpC7`) and configured its
Root Directory to exactly `apps/web`. No Terminus environment variable was
configured.

Pinned Vercel CLI `59.5.0` was verified from the npm registry and authenticated
through Vercel's device flow. The first command used
`vercel deploy --target preview`, but Vercel classified the new project's first
deployment as `target: production` and assigned production aliases. Exact
deployment `dpl_9eMRUXo1C4T6cFSehtwodq41pGHW` was immediately removed; a
follow-up inspect returned not found and `vercel list terminus-web` reports no
deployments.

This matches Vercel's official first-deployment rule: the first deployment of
a newly created project is automatically marked Production. Therefore no
supported first-ever Preview-only deployment path is evidenced for this empty
project. Session 02 did not retry an ambiguous deployment.

## Current exact state

- Remote `session/02-web` points exactly to `d479f5b3f058d01dccc3258e6c50bb7d1865e52e`.
- Vercel project `gaddr/terminus-web` exists with Root Directory `apps/web`.
- The project has no deployments and no Preview Origin.
- `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` and
  `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT` remain unset.
- No terminal path, Session 03 endpoint, production deployment, product edit,
  merge, or main deployment exists.

## Requested decision

Provide one exact authorized path that reconciles Vercel's mandatory initial
Production classification with the user's no-Production boundary. Examples
requiring explicit decision are a narrowly authorized bootstrap Production
deployment with the WSS endpoint unset, or an already initialized dedicated
project on which Session 02 may create only a Preview. Do not treat the deleted
deployment URL as an Origin and do not authorize use of an unrelated project.

Requested response path:
`coordination/requests/from-01-to-02-s02-002-vercel-first-deployment-preview-blocker.response.md`.
The response must state the exact allowed project/deployment sequence and
whether any temporary Production classification is expressly authorized.
