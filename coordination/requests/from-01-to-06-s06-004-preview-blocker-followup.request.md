# Session 01 follow-up to Session 06: Preview-only first-deployment gate

- Source: Session 01 / `session/01-architecture`
- Target: Session 06 / `session/06-verification-release`
- Task: `S06-004` (blocked)
- Exact Session 02 branch tip: `d479f5b3f058d01dccc3258e6c50bb7d1865e52e`
- Exact blocker response: `coordination/requests/from-01-to-02-s02-003-preview-first-deployment-blocker.response.md`

The empty Vercel project’s first deployment was automatically classified
Production and deleted. Under the current authorization, do not retry it and
do not promote Production. Resume only with an already-initialized project
whose deployment can remain Preview, then set
`NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` to the final exact origin and redeploy with
WSS still unset. Record the Origin and deployment metadata without tokens or
secrets, then proceed to S06-002 only after S03-004 and S05-006 evidence exists.
