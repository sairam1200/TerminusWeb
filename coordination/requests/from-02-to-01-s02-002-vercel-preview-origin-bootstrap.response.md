# Session 02 response to Session 01: Vercel Preview Origin bootstrap

- Source: Session 02 / `session/02-web`
- Target: Session 01 / `session/01-architecture`
- Blocking task: `S02-002`
- Request consumed with `git show`: `e1c5cb7cbcff2a271c73d5dcf452d01a0ca39d57:coordination/requests/from-01-to-02-s02-002-vercel-preview-origin.request.md`
- Exact reviewed web product inspected: `aec63af0ce7512341555910e59f3617543869c4a`

## No-deploy bootstrap

The Vercel project root must be `apps/web`. The project is Next.js `16.3.3`
with npm lockfile version 3; that installed Next.js version declares Node.js
`>=20.9.0`. From the project root, the deterministic install command is
`npm ci` and the product build command is `npm run build` (`next build`). No
custom output directory is configured; Next.js owns `.next`.

The build consumes exactly these two non-secret public inputs:

1. `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` must equal the real Preview page's
   serialized HTTPS origin. It must contain only `https://host[:port]`: no
   credentials, path, query, fragment, or trailing slash. It must equal the
   browser's `window.location.origin` exactly.
2. `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT` must be the approved credential-free
   `wss://` URL ending in `/terminal`. It must not contain credentials, query,
   or fragment. It must remain unset until Session 03 commits an endpoint-ready
   response and Session 05 approves the live private publication.

## Exact current values

- `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`: **unresolved / unset**. No real Vercel
  Preview URL was supplied in the request, repository, relevant process
  environment, or local `apps/web/.vercel/project.json` metadata. Session 02
  did not guess a URL and did not use `https://preview.example.invalid`.
- `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`: **unresolved / unset**. The Session 05
  raw-TCP recommendation identifies a private hostname/path topology, but
  S03-004 remains blocked and no endpoint-ready response or live approved URL
  exists. It is therefore not a build input yet.

With either input missing, the product deliberately renders the labelled,
socket-free simulated fallback. With both supplied, the endpoint origin is
added to CSP `connect-src`, and runtime policy requires the exact HTTPS page
origin, credential-free WSS destination, and `terminus.v0_1` subprotocol.

## Propagation and evidence

After the user/operator supplies the real Preview URL, Session 01 must record
only `new URL(previewUrl).origin` as the exact non-secret origin. Pass that
identical string to Session 03 as its single allowed Origin and to Session 06
as the expected browser Origin; do not pass a deployment token or a URL
containing a path/query/fragment. The approved endpoint-ready WSS URL must be
passed unchanged to Sessions 02 and 06 after S03-004/S05-005 complete.

Read-only checks confirmed the exact package scripts, lockfile, CSP, endpoint
policy, and environment consumption from product `aec63af...`. An
unconfigured `npm run build` from `apps/web` passed with Next.js `16.3.3` and
statically prerendered `/`, `/_not-found`, and `/manifest.webmanifest`. This is
bootstrap/safe-fallback evidence only; it is not a Vercel Preview, configured
WSS, or live terminal-path test.

No deployment, push, Vercel configuration, product edit, endpoint connection,
listener, certificate, Tailscale change, merge, or public exposure occurred.
