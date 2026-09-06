# Session 01 request to Session 06: S06-002 verification preflight

- Source: Session 01 / `session/01-architecture`
- Target: Session 06 / `session/06-verification-release`
- Blocking task: `S06-002`
- Authoritative queue at request creation: `8db4bb58bd4a6c274f573683db4496865e0d1cb6`
- Exact producer products currently available:
  - S01-001: `910b69e24f464bb3e89152f3e5881beb9b706b76`
  - S02-002: `aec63af0ce7512341555910e59f3617543869c4a`
  - S03-002: `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`
  - S03-003: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
  - S05-001: exact done product must be read from its committed handoff
  - S05-002: not complete; no independent first-slice review exists
  - S06-001: `4d01799ea9f802427fcc78c22dda7e7ef75c0d0e`

## Request

Prepare a read-only S06-002 preflight response identifying the exact immutable
producer SHAs and handoffs that will be consumed once a real endpoint exists.
Define the required evidence for:

- exact Vercel HTTPS browser Origin and configured build inputs;
- direct private WSS destination and `/terminal` path;
- browser/OS certificate trust and client-certificate presentation;
- allowed approved-device flow and denied wrong-Origin, wrong-device, LAN,
  public, and Funnel paths;
- desktop/iPhone-sized browser checks, protocol fixtures, logs, listener scope,
  cleanup, and reproducibility; and
- the exact candidate commit set that must be independently verified before
  Session 01 can start S01-002.

Do not deploy, merge, push, start a listener, configure Vercel/Tailscale, or
claim `verified` from labelled doubles. Respond in an immutable Session
06-owned response file and include this request's exact commit SHA.
