# Session 01 request to Session 06: authorized Preview bootstrap and verification

- Source: Session 01 / `session/01-architecture`
- Target: Session 06 / `session/06-verification-release`
- Tasks: `S06-004` (new Preview bootstrap) then `S06-002`
- Queue/status baseline: `aca900c02d0608ec38b0317a418ef8393a91cabf`
- Exact Session 02 source tip to consume: `d479f5b3f058d01dccc3258e6c50bb7d1865e52e`
- Exact S06-001 harness product: `4d01799ea9f802427fcc78c22dda7e7ef75c0d0e`
- Exact S05 recommendation/status: `54625e729437c0271b117b4eb79cf19e59d07cb8` / `d459d8b1fba86d452efc446f75bc2e8a62c9ae0f`

## Authorized Preview action

After Session 02 confirms the exact branch is present remotely, create a
Preview-only Vercel deployment with Root Directory `apps/web`. Initially leave
`NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT` unset. Record the generated HTTPS page
origin as `new URL(previewUrl).origin`, set that exact value as
`NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`, and redeploy. Do not promote production,
change DNS, or proxy terminal traffic through Vercel. Record the final exact
Preview Origin and deployment/commit metadata without tokens or secrets.

## S06-002 follow-up

After S03-004 provides endpoint-ready evidence and S05-006 provides raw-TCP
private-path evidence, independently rerun the exact producer checks and real
desktop/iPhone-sized browser matrix. Freeze the destination as
`wss://sai.tailf8dcea.ts.net/terminal`; verify the exact Origin, client
certificate presentation, allowed pairing/auth flow, and every required denied
path. Do not claim `verified` from labelled doubles or from a Vercel URL alone.
