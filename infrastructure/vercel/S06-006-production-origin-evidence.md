# S06-006 production Origin freeze evidence

Date: 2026-08-30 (Asia/Calcutta)

## Verdict and scope

Owner verification result: **PASS, pending independent review of this evidence commit**.

This report freezes the authorized production browser Origin and proves that the
exact current web product can be built for it without deploying:

- web product: `bf7ca71b437907e7d25251e54d59355440797ad4`;
- browser HTTPS Origin: `https://terminus-web.vercel.app`;
- direct private WebSocket destination: `wss://sai.tailf8dcea.ts.net`;
- Vercel project: `gaddr/terminus-web`;
- Vercel Root Directory: `apps/web`;
- Vercel production branch: `main`.

The live stable alias is healthy, but it does **not** yet serve the candidate.
It resolves to deployment `dpl_9h1hGq6DPsQykoBkVogqcbUxxv2u`, whose Git SHA is
the older ancestor `5762f5865608596c8198d583a2dbd394ac973a7b`. Deployment
of `bf7ca71...` remains gated on the verified integration candidate.

No deployment, promotion, push, merge, Vercel setting/environment mutation,
DNS/Tailscale/certificate mutation, browser-login change, terminal connection,
or terminal-data inspection occurred.

## Inputs and dependency identity

- Authoritative queue: `097b2b085b7df02504d00c8274921db5f6e31885`.
- `S02-004` is `done` there. Its status-only handoff is
  `1e52575afeacba4cff2b79567b229b9d84c00686`, naming exact reviewed product
  `bf7ca71b437907e7d25251e54d59355440797ad4`.
- `S06-001` is `done`; its exact cumulative product is
  `4d01799ea9f802427fcc78c22dda7e7ef75c0d0e`.
- The isolated input worktree was detached and clean at `bf7ca71...` before and
  after verification. Generated ignored dependency/build files were permitted;
  no tracked product file changed.

## Exact local candidate verification

Environment: Windows `10.0.26200.0`, PowerShell `5.1.26100.9168`, Node
`v24.15.0`, npm `11.14.1`, Next.js `16.3.3`, Vitest `4.1.11`.

Commands ran from `E:\terminus\.worktrees\s06-web-bf7\apps\web` unless stated
otherwise.

1. `npm ci`
   - Sandboxed attempt: exit 1, `spawn EPERM` during install-script execution.
   - Unchanged approved outside-sandbox rerun: exit 0; 443 packages installed,
     444 audited, 0 vulnerabilities.
2. `npm run typecheck`: exit 0.
3. `npm run lint`: exit 0.
4. `npx vitest run --reporter=verbose`
   - Sandboxed attempt: exit 1, `spawn EPERM` before test discovery.
   - Unchanged approved outside-sandbox rerun: exit 0; 7 files and 41 tests
     passed, 0 skipped.
5. Process-scoped configured production build:

   ```powershell
   $env:NEXT_PUBLIC_TERMINUS_WEB_ORIGIN='https://terminus-web.vercel.app'
   $env:NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT='wss://sai.tailf8dcea.ts.net'
   npm run build
   ```

   The sandboxed attempt compiled successfully, then exited 1 with `spawn EPERM`
   when starting the TypeScript worker. The unchanged approved outside-sandbox
   rerun exited 0, compiled and typechecked, and statically generated `/`,
   `/_not-found`, and `/manifest.webmanifest`.

6. Generated-output checks:
   - `.next/routes-manifest.json` contains the exact header
     `connect-src 'self' wss://sai.tailf8dcea.ts.net` and no other network
     destination.
   - `.next/server/app/index.html` and server output contain the exact pair
     `endpoint: wss://sai.tailf8dcea.ts.net` and
     `expectedWebOrigin: https://terminus-web.vercel.app`.
   - SHA-256 of `.next/routes-manifest.json`:
     `4C1AE9980DF5CCDC2A0FCC68E8C64572E69E8C8489A037438334BFF7B104016B`.
7. Source-boundary scan found no `app/**/route.ts` or `/api/` terminal route.
   The real client constructs `new WebSocket(url, subprotocol)` in
   `apps/web/terminal/protocolTerminalAdapter.ts`; Vercel is not a terminal
   relay in this candidate.
8. `git diff --exit-code` and `git diff --check`: exit 0 after all candidate
   checks.

### Formatting caveat

`npm run format:check` exited 1 and listed 32 unchanged web files. This detached
Windows checkout has `i/lf w/crlf` for the affected files because system Git
sets `core.autocrlf=true`; Git nevertheless reports a clean worktree and
`git diff --check` passes. The verifier did not rewrite product files or hide
the outcome. The exact S02-004 owner handoff separately records its source
format checks as passing before commit.

## Read-only Vercel and live HTTPS evidence

All Vercel calls used authenticated CLI `59.5.0` with GET/inspect/list only.
Selected API output was restricted to non-secret metadata.

- `vercel project inspect terminus-web --scope gaddr --no-color`: exit 0;
  project `gaddr/terminus-web`, Root Directory `apps/web`, Node.js `24.x`,
  Next.js preset, default build/output/install settings.
- Authenticated `GET /v9/projects/terminus-web`: exit 0; non-secret selected
  fields confirm `rootDirectory=apps/web`, `nodeVersion=24.x`,
  `buildCommand=null`, and `productionBranch=main`.
- `curl.exe --silent --show-error --dump-header - --output NUL
https://terminus-web.vercel.app/`: exit 0; `HTTP/1.1 200 OK`, `Server: Vercel`,
  HSTS enabled, and live CSP includes only
  `connect-src 'self' wss://sai.tailf8dcea.ts.net`.
- Playwright CLI opened the stable Origin in Chromium, title `Terminus`.
  Desktop and `390 x 844` snapshots both exposed the accessible terminal shell
  and displayed `sai.tailf8dcea.ts.net`; mobile reported portrait `43 x 21`.
  Browser console: 0 errors and 0 warnings. This proves asset rendering only,
  not a terminal connection or physical iPhone/Safari behavior.
- `vercel inspect https://terminus-web.vercel.app`: exit 0; stable alias points
  to ready Production deployment `dpl_9h1hGq6DPsQykoBkVogqcbUxxv2u`.
- Authenticated `GET /v13/deployments/dpl_9h1hGq6DPsQykoBkVogqcbUxxv2u`:
  selected fields identify Git SHA
  `5762f5865608596c8198d583a2dbd394ac973a7b` on
  `session/02-web-renderer`. Git proves that SHA is an ancestor of `bf7ca71...`,
  while the reverse ancestry check fails. The live Origin is therefore not
  presented as deployment proof for `bf7ca71...`.

## Why `aa09734` is not a web-source candidate

Read-only Vercel log retrieval for failed Preview deployment
`dpl_988Hz8bhsduMSowLoTKZBBJjRxiU` records:

- branch `session/01-architecture`;
- commit `aa09734`;
- final error: Next.js could not find a `pages` or `app` directory.

Repository object inspection independently confirms that
`aa09734f5549ea69954a8c9817a610297c261f62` contains only
`apps/web/.gitkeep`; `apps/web/package.json` lookup exits 128. Neither commit is
an ancestor of the other, and `bf7ca71...` contains 37 tracked web paths.
Therefore the failed architecture Preview cannot stand in for, or build, the
authorized web product.

## Evidence classification and residual limits

- Real local code: exact candidate install, static production build,
  typecheck, lint, 41-test suite, generated CSP/configuration, source data-path
  inspection.
- Real external metadata: authenticated Vercel project/deployment GETs and live
  HTTPS/Chromium checks.
- Not verified here: deployment of `bf7ca71...`, private WSS reachability,
  mTLS/client-CA behavior, Chrome/Firefox on Android/iPhone, physical iPhone
  Safari, Windows agent/ConPTY, Tailscale allowed/denied paths, certificate
  generation/trust, or terminal lifecycle. These belong to later gated tasks.
- Resource lock `VERCEL-20260830-01` remained read-only throughout.
