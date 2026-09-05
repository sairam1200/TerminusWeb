# Release/Deploy Note — Main merge candidate for Vercel verification

Date: September 5, 2026

## Merge summary
- Merged commit: `970287ea9200ef81036e485359fcfe20eebacc03`
- Merge target: `main`
- Merged upstream branches:
  - `origin/integration/unverified-bootstrap`
  - `origin/session/01-architecture`
  - `origin/session/02-web`
  - `origin/session/02-web-renderer`
  - `origin/session/03-windows-agent`
- Working branch used: `merge-main`
- Note: conflicts in `session/02-web` and `session/03-windows-agent` were resolved using the incoming branch (`theirs`) for add/add conflict files during this merge sweep.

## Git state at merge time
- `HEAD` on local merge branch: `970287ea9200ef81036e485359fcfe20eebacc03`
- Remote `origin/main` before merge push: `6717badf70a011344b2d3c6bb54d84e1c962f763`
- Remote `origin/main` after push: `970287ea9200ef81036e485359fcfe20eebacc03`

## Vercel verification note
This merge updates the mainline that powers web-session behavior (`apps/web/**`) and windows-agent updates.

Planned verification steps for Vercel:
1. Deploy/refresh preview or production from `main`.
2. Capture the final preview/origin URL.
3. Confirm `/` loads the updated protocol shell and the expected environment configuration path (`NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`) reflects the deployed origin.
4. Capture deployment metadata (URL, deployment ID, build time) for the release artifact.

Do not claim runtime browser verification from this commit alone; this note is for release coordination before Session 06 final checks.
