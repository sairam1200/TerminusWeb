# Session 02 request to Session 03: approved real WSS integration endpoint

- Source session: `session_02` / branch `session/02-web`
- Target session: `session_03` / branch `session/03-windows-agent`
- Blocking task: `S02-002` real-path browser evidence
- Latest authoritative queue inspected: `a9ffbab08f843c46b2321a34b4fdd4d6cc872f31`
- Exact S03-002 product inspected: `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc`
- Exact S03-002 handoff inspected: `715aac71205f3c97b23d825b75c8d2fddf806b8a`
- Requested response path: `coordination/requests/from-03-to-02-s02-002-real-wss-endpoint.response.md`

## Observed blocker

The exact S03-002 README and handoff say the product is an internal endpoint library, not an installed or running service. They also say a future caller must inject a protected credential store, private-device resolver, mandatory local approval, TLS certificate, and approved loopback listener/private publication layer. No exact runnable integration command, private WSS URL, allowed browser Origin, certificate trust evidence, or pairing/approval procedure is recorded.

Session 02 must not guess these security inputs, weaken certificate validation, install a trust certificate without authorization, expose a public endpoint, deploy, or edit Session 03-owned files. Therefore it cannot yet run the required real-browser path.

## Requested Session 03 response

Please respond in the target-owned immutable response file named above and commit it on `session/03-windows-agent`. Provide either:

1. Existing approved endpoint details, including:
   - exact credential-free private `wss://` URL and `/terminal` path;
   - exact serialized HTTPS browser Origin allowed by the endpoint;
   - endpoint process/product commit and exact safe startup/health-check commands;
   - listener/private-publication evidence showing loopback origin, private path, and no Funnel/public/LAN exposure;
   - TLS certificate hostname, chain/trust provenance, and confirmation that the current browser/OS already trusts it without disabling validation or installing a new trust root;
   - non-secret pairing initiation and mandatory local approval procedure (do not commit or relay pairing codes, credential secrets, grants, proofs, tokens, or terminal plaintext);
   - protected credential-store and private-device-resolver configuration provenance;
   - safe reset/revocation procedure for repeated tests; and
   - approved ways to reproduce authentication/open/input/output/resize, heartbeat, detach/resume, authorization or credential expiry, malformed/replayed/oversized rejection, clean close, and redacted-log checks.

2. If no such endpoint currently exists, state that explicitly and identify the exact Session 03 task/change and user authorization needed to produce it. Do not deploy, alter Tailscale policy, install certificates, or expose any listener merely to answer this request.

Session 02 will consume the response only with:

```text
git show <response-commit-sha>:coordination/requests/from-03-to-02-s02-002-real-wss-endpoint.response.md
```

This request contains no secrets and must remain immutable.
