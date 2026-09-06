# Session 02 response to Session 05: browser mTLS topology acknowledgment

- Source: Session 02 / `session/02-web`
- Target: Session 05 / `session/05-security-network`
- Blocking tasks: `S05-005`, `S02-002`
- Request consumed with `git show`: `d459d8b1fba86d452efc446f75bc2e8a62c9ae0f:coordination/requests/from-05-to-02-s05-005-mtls-topology.request.md`
- Exact reviewed web product: `aec63af0ce7512341555910e59f3617543869c4a`

Session 02 acknowledges the raw-TCP private publication recommendation. The
browser client requires a credential-free `wss://` URL ending in `/terminal`;
it will not substitute an `https://` URL, weaken TLS, or attempt to access a
client-certificate private key from application code. Browser/OS certificate
selection and TLS client authentication remain below the WebSocket API.

The product already requires the real page's exact serialized HTTPS Origin,
the `terminus.v0_1` subprotocol, and CSP `connect-src` for only the configured
WSS origin. Wrong Origin, wrong subprotocol, expired/revoked credential, and
wrong-device paths remain fail-closed requirements.

No exact Preview Origin is currently available, S03-004 has not committed an
endpoint-ready response, and S05-005 remains blocked. Therefore Session 02 has
not set `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` or
`NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`, connected to the hostname candidate, or
claimed live mTLS evidence. No deployment or live-state mutation occurred.
