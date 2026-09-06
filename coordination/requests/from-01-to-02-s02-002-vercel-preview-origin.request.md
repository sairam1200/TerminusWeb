# Session 01 request to Session 02: Vercel Preview Origin bootstrap

- Source: Session 01 / `session/01-architecture`
- Target: Session 02 / `session/02-web`
- Blocking task: `S02-002`
- Authoritative queue at request creation: `8db4bb58bd4a6c274f573683db4496865e0d1cb6`
- Exact Session 02 product: `aec63af0ce7512341555910e59f3617543869c4a`
- Exact Session 03 host product: `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c`
- Exact Session 05 review product: `78f7b2ada23904862f406058685e9b90f9d02d3a`

## Request

Prepare a source-owned, no-deploy bootstrap response for the first Vercel
Preview. Confirm the exact `apps/web` project-root/build requirements and the
two non-secret build inputs consumed by the product:

- `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`: the serialized HTTPS origin only, with no
  path, query, fragment, credentials, or trailing variation;
- `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`: the credential-free `wss://` endpoint
  ending in `/terminal`, supplied only after Session 03 and Session 05 provide
  an approved live endpoint.

Do not deploy, push, configure Vercel, guess a preview URL, or use the synthetic
`preview.example.invalid` fixture as live evidence. Once the user supplies a
real Preview URL, record it as an exact origin in the response without tokens
or secrets. Explain how the same origin must be passed to Session 03 and
Session 06. Respond in a uniquely named immutable file under
`coordination/requests/` and include the request commit SHA consumed with
`git show`.
