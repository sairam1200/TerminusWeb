# Session 06 response: S06-002 exact-SHA verification preflight

- Source: Session 06 / `session/06-verification-release`
- Target: Session 01 / `session/01-architecture`
- Responds to request commit: `e1c5cb7cbcff2a271c73d5dcf452d01a0ca39d57`
- Request path: `coordination/requests/from-01-to-06-s06-002-verification-inputs.request.md`
- Blocking task: `S06-002`
- Authoritative queue commit inspected: `d57b80f47f7024d218c74708bb23acc97de72806`
- Preflight result: **BLOCKED / NOT VERIFIED**

This response is a read-only preflight inventory. It is not an S06-002 product,
handoff, PASS result, integration result, or release claim. No result from a
labelled double, simulation, mock WebSocket, synthetic TLS server, or
iPhone-sized Chromium emulation will be reported as a real private-path result.

## Exact immutable inputs currently available

| Task/artifact | Product or evidence commit | Handoff/status commit | Queue/readiness conclusion |
|---|---|---|---|
| S01-001 protocol/security 0.1 | `910b69e24f464bb3e89152f3e5881beb9b706b76` | `d87980c707c4947162690e0fe8b9decf5c32f8f7` | `done`; candidate for independent reproduction |
| S02-002 web consumer | `aec63af0ce7512341555910e59f3617543869c4a` | `097ddfa66b0dcf281fcbfdbd2ad2ebbfcb90377f` | `blocked`; deterministic owner/reviewer evidence only |
| S03-002 endpoint library | `6e5ff870ea9b8f4da9d7de7d0636724a67eb48cc` | `715aac71205f3c97b23d825b75c8d2fddf806b8a` | `done`; candidate for independent reproduction |
| S03-003 integration host | `b52e3bb4493745909ab0fc3f65aa95ebb62dc33c` | `662e376094c631890dd22d23391ff6a7e62d8a30` | `done`; implementation exists but was not started |
| S03-004 authorized host run | none | none | `blocked`; endpoint-ready evidence absent |
| S05-001 policy/threat model | `ccc6a11c97b26223e8aa8d7d9c0b4fda5eba9a3e` | `3aea4f9b22d7e5d643019acb25b83c37d87aa8b1` | `done`; policy is still a proposal, not live proof |
| S05-002 first-slice review | none | none | `blocked`; required independent producer review absent |
| S05-005 static publication review | `d95841ea4829a1a5a3a51b0b3f6f3babf3ef26d8` | `de4fb65f923bb29f4ab7e6ed756ed3309ac2d61c` | static/read-only evidence only |
| S05-005 mTLS recommendation | `54625e729437c0271b117b4eb79cf19e59d07cb8` | `d459d8b1fba86d452efc446f75bc2e8a62c9ae0f` | `blocked`; no live allowed/denied proof |
| S05-005 transport response | `eb4530f299862da4aca1d7ebcd2cca896cd4bc10` | none | raw TCP recommendation only; no route configured |
| S06-001 verification harness | `4d01799ea9f802427fcc78c22dda7e7ef75c0d0e` | `61ae8665e6a8770f955dd6556282296cee6d88f2` | `done`; doubles remain non-release evidence |

Preflight commands run against every commit above:

- `git cat-file -t <sha>`: every supplied SHA resolved as a `commit`.
- `git show --check --format= --no-renames <sha> --`: exit `0` for every supplied commit.
- `git merge-base --is-ancestor <product> <handoff>`: exit `0` for S01-001, S02-002, S03-002, S03-003, S05-001, both recorded S05-005 product/status pairs, and S06-001.

These checks establish immutable object availability and recorded ancestry only.
They do not reproduce any producer test or live-path claim.

## Inputs that must be frozen before S06-002 can start

1. **Exact browser Origin.** Session 01 must supply the exact deployed HTTPS
   Vercel Preview origin, without a path, wildcard, placeholder, or inferred
   production alias. It must be the value used for
   `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN` and the agent's exact `-origin` allowlist.
2. **Exact private WSS destination.** Session 01 must freeze one destination in
   the form `wss://<approved-private-host>:<port>/terminal`, plus the exact
   configured `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`. `/terminal` is required and
   raw TCP publication must not rewrite it.
3. **Hostname conflict resolution.** Session 01 facts and prior read-only host
   evidence name `sai.tailf8dcea.ts.net`; S05 response
   `eb4530f299862da4aca1d7ebcd2cca896cd4bc10` names
   `sai.tail98bed6.ts.net`. Neither value will be guessed or silently selected.
   Session 01 must record one authoritative hostname before certificate or
   network verification.
4. **Server trust inputs.** Supply non-secret paths/identifiers for a server
   certificate and private key kept out of Git. Metadata must prove SAN coverage
   for the frozen hostname, ServerAuth EKU, validity, and browser/Windows trust.
   Private-key bytes must never enter evidence.
5. **Client identity inputs.** Supply the client-CA bundle and an installed or
   browser-selectable client certificate whose metadata proves an explicit
   ClientAuth EKU, validity, issuer chain, and device binding. The currently
   recorded browser leaf without explicit ClientAuth is not accepted as a
   completed input.
6. **S03-004 endpoint-ready handoff.** It must record the exact S03 product,
   non-elevated Windows identity, loopback address and port, exact Origin,
   certificate metadata, `/healthz` result, protected-store lifecycle,
   listener-scope snapshot, secret-safe log path, and cleanup result. It must
   contain no pairing code, credential, PFX password, private key, or terminal
   plaintext.
7. **Private publication evidence.** Supply the exact approved raw-TCP Serve
   mapping to the S03-004 loopback port, the complete read-only Serve status,
   independently readable Funnel-disabled status, applicable policy revision,
   and rollback snapshot. A proposal or `tailscale ping` is insufficient.
8. **S05 completion.** S05-005 must contain real allowed and denied private-path
   evidence, and S05-002 must provide the completed exact-SHA first-slice
   security review with its product, named reviewer, and status-only handoff.

## Independent S06-002 evidence plan

All producer checks will be rerun from exact immutable commits in temporary
Session 06-owned locations. Raw commands, exit codes, tool versions, OS/browser
environment, skips, and failures will be retained without secret or terminal
content.

### Deterministic exact-code evidence

- Run the S01-001 contract verifier and all accepted/rejected fixtures,
  authentication vectors, malformed/unknown/version/state/direction/sequence,
  replay, gap, UTF-8, decoded-limit, and oversized-wire cases.
- Run the same canonical fixtures through the exact S02 and S03 consumers;
  fixture-name similarity or producer-reported results are not sufficient.
- For the exact web commit, run clean dependency installation from its lockfile,
  formatting, lint, typecheck, unit tests, default build, and configured build
  using the frozen Origin/WSS values. Inspect the emitted CSP and require only
  the exact private WSS source.
- For the exact Windows commits, run formatting, vet, build, short/full tests,
  ConPTY lifecycle tests, repeated concurrency tests, listener rejection,
  pairing/authentication, expiry, replay, malformed/oversized rejection,
  heartbeat, detach/resume, close, cleanup, and redaction checks under a
  recorded non-elevated identity.

### Real browser and real private-path evidence

- Desktop Chromium and iPhone-sized Chromium flows must use the configured web
  build and the real private WSS endpoint. Emulation is labelled
  `real-browser/iPhone-sized`, not physical-iPhone or Safari evidence.
- Verify browser/OS server trust without an ignore-certificate flag and prove
  client-certificate presentation reaches the S03 host's
  `RequireAndVerifyClientCert` boundary.
- Verify `terminus.v0_1`, exact Origin acceptance, pairing confirmation,
  authentication, open, input/output, resize, heartbeat, detach/resume,
  foreground/background recovery, expiry, close, and process cleanup.
- Prove an allowed approved-device path. Separately prove denial for wrong
  Origin, wrong subprotocol, wrong/absent/expired client certificate, wrong or
  unlisted tailnet device, LAN source, public source, and Funnel/public access.
- Capture before/during/after TCP listener tables and require the agent itself
  to remain loopback-only. A Tailscale publication process is not evidence that
  the agent bound a LAN, wildcard, public, or tailnet-interface address.
- Scan application, browser, test, and captured runtime logs for pairing
  material, credentials, challenges/proofs, tokens, terminal plaintext,
  commands, clipboard data, private keys, PFX passwords, and reusable hashes.

### Evidence classification

- `deterministic-exact-code`: exact-commit build/unit/fixture results.
- `real-windows`: non-elevated Windows/ConPTY and local lifecycle evidence.
- `real-browser`: configured desktop or iPhone-sized browser against real WSS.
- `real-private-network`: independently observed allowed and denied paths over
  the actual private publication.
- `mock`, `simulated`, or `labelled-test-double`: supporting regression evidence
  only; never sufficient for `verified`.

Any missing live input, trust bypass, unavailable denied-path source, skipped
required gate, non-loopback agent listener, enabled Funnel, unexpected public
or LAN success, cleanup residue, plaintext/secret leakage, or commit mismatch
causes S06-002 to remain unverified and produces a FAIL/blocker handoff.

## Candidate set required before S01-002

Session 01 cannot yet freeze the integration manifest. Before S06-002 begins,
it must send one immutable candidate list containing the final product and
handoff SHAs for S01-001, S02-002, S03-002, S03-003, S03-004, S05-001,
S05-002, S05-005, and S06-001, plus the exact endpoint-ready and
private-publication evidence commits. The currently missing S03-004 and
S05-002 products, blocked S02-002/S05-005 states, hostname conflict, Origin,
and live path prevent a complete candidate set.

No producer code, shared contract, certificate, listener, Serve/Funnel state,
Vercel state, Tailscale policy, deployment, merge, or push was changed while
preparing this response.
