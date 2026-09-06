# S05-002 protocol and first-slice consumer security review

Status: owner review complete. This is Session 05 security evidence, not a
Session 06 `verified` or release-ready claim.

## Exact review inputs

- Authoritative queue: `fd56e75f97f9ed4ad559aa653984bdefc8ed7037`;
  S05-002 is `ready` and depends on S01-001, S02-002, S03-002, and S05-001.
- Queue status baseline: `710194431da4e705e5f4d5cfed014581cf81dd0f`.
- Protocol/security contract: `910b69e24f464bb3e89152f3e5881beb9b706b76`.
- Web consumer and browser regression:
  `16e850a34b56a315fb78c137ddae6d38220180ea`.
- Windows agent cumulative security fix:
  `0446e685489d2e9d09715d6cc5ba011a5471a540`.
- Reviewed private-publication design:
  `e4a362922f2487b685d06e27dd02bd2f7b52e656`.
- Read-only live private-route evidence:
  `e823add5f5495e9f66339dfcd3f81731d3e3cfd9`.

The protocol and agent commits were inspected in detached exact-commit
worktrees. The web gates ran from its status-only descendant after confirming
that `apps/web` was byte-identical to the exact product tree. Session 05 did not
edit either consumer, mutate the live endpoint, connect a browser, or send a
terminal frame.

## Verdict and severity

No unresolved Critical, High, or Medium product finding was reproduced in the
reviewed slice. The reviewed implementations fail closed at the relevant
contract boundaries, keep terminal data off Vercel, and contain the previously
reported stalled-open/revocation availability exposure.

The remaining items in **Release gaps** are evidence limitations, not a claim
that the unexercised paths pass. In particular, this review does not claim
physical mobile compatibility or Chrome/Firefox certificate persistence.

## Reproduced security matrix

| Boundary | Reproduced evidence | Result |
| --- | --- | --- |
| Protocol schema/transcripts | Exact protocol verifier checked schema semantics, 22 transcripts, 27 fixtures, one positive authentication vector, and four negative mutations. | PASS |
| Pairing and stored reconnect | The exact web regression accepts one pairing challenge, stores an IndexedDB credential, reconnects using that credential, and asserts no second pairing prompt or credential creation. The exact agent tests cover pairing consumption, wrong proof, expired/unsupported challenges, and stored-credential reconnect. | PASS, deterministic/browser-storage implementation evidence |
| Origin, subprotocol, and mTLS | Exact agent tests reject wrong Origin, wrong subprotocol, and missing/untrusted client identity. S05-006 independently observed no/unrelated certificate denial, hostile Origin HTTP 403, wrong subprotocol HTTP 426, and exact WSS upgrade through raw TCP using an existing ClientAuth identity. | PASS, deterministic plus live transport metadata |
| Authentication order and replay/state | Exact agent tests cover authentication failure, sequence replay, connection-ID reuse, authorization expiry/deadline, and malformed/oversize WSS input. The cumulative fix preserves `AUTHENTICATION_FAILED` ahead of revocation disclosure. | PASS |
| Revocation and stalled open | Exact agent tests cover revocation before/during open, revocation winning over concurrent terminal failure, late open completion, client disconnect, and concurrent stalled opens. The selected adversarial set passed 20 repeated runs. No fixed session cap was introduced. | PASS |
| Rate and resource bounds | Concurrent reservation tests, WSS read limit, bounded pending output, and lifecycle cleanup checks passed. Real Windows ConPTY cleanup was separately reproduced against the exact agent in Session 06. | PASS for implemented bounds; actual host exhaustion was not induced |
| Secret and plaintext boundary | Source/test scans found only denial prose and synthetic fixtures. No real certificate private key, auth token, reusable pairing value, command, clipboard value, or terminal plaintext is present in the reviewed evidence. The agent logger denial regression passed. | PASS |
| Direct browser-agent path | The exact web adapter constructs `WebSocket(url, subprotocol)` from the public WSS setting. No terminal API route, fetch relay, persistence, or logging path was found. The live route is raw TCP to the loopback agent; Vercel serves web assets only. | PASS |
| Private publication | S05-006 recorded a loopback-only `127.0.0.1:8443` origin and tailnet-only raw TCP 443 forwarding with no Funnel, HTTP handler, TLS termination, or path rewrite. Pre/post state was identical. | PASS within the observed private-node scope |

The pairing/storage regression exercises the browser-shaped IndexedDB and
WebCrypto path using `fake-indexeddb` and Node WebCrypto; it is not a live
physical-device or production-browser pairing. The S05-006 WSS probe
intentionally sent no application frame, so the live evidence supports
transport security metadata rather than a complete authentication/resume
exchange.

## Findings disposition

### Closed: stalled-open and revocation availability (previously Medium)

The exact cumulative agent commit bounds concurrent terminal opens without
imposing a fixed total-session cap, frees reservations after failures and
disconnects, and keeps revocation failure ordering deterministic. Repeated
adversarial tests covered stalled, late-completing, revoked, and concurrently
failing opens. This review did not reproduce the earlier availability issue.

### Informational: exact static build output is not byte-stable

Two exact web builds passed but produced different Next-generated HTML hashes,
and neither matched the producer's recorded hash. This is informational because
the security-bearing source, CSP/origin configuration, route manifest, tests,
and exact commit were independently checked; no byte-for-byte release artifact
identity is claimed here.

### Informational: live route proof has bounded vantage

The live report used the selected Windows/tailnet node and an unrelated client
certificate. It did not have a separately controlled wrong-tailnet peer, the
complete additive grants/ACL policy surface, or an external public vantage.
Those omissions remain explicit release gates below.

## Deterministic commands and outcomes

Protocol verifier, from the exact protocol commit's `packages/protocol`:

```text
npm run verify

PASS: schema semantics, 22 transcripts, 27 fixtures,
      1 positive authentication vector, 4 negative authentication mutations.
```

The first invocation was mistakenly issued from the repository root and failed
with `ENOENT` for a missing root `package.json`; rerunning from the package
directory passed. This was an invocation error, not a product failure.

Selected exact-agent adversarial suite:

```text
go test -short -count=20 -run \
  '^(TestStoredCredentialReconnect.*|TestHandshakeOriginProtocolAndTLSRejections|TestAuthorizationExpiry.*|TestAuthorizationDeadline.*|TestConcurrentRateLimitReservations|TestConnectionIDCannotBeReused|TestCredentialRevocation.*|TestUnsupportedNegotiationAndExpiredChallenge|TestAuthenticationReplayOversizeAndPairingConsumption|TestWSSOversizeMessageClosesWith1009|TestWrongAuthenticationProofAndSequenceReplay.*|TestStalledOpen.*|TestLateTerminal.*|TestConcurrentStalled.*|TestServeTLSRejectsNonLoopbackListener|TestLoggerReceivesNoSecretsOrTerminalPlaintext)$' \
  ./internal/endpoint

PASS (20 repetitions).
```

Additional exact-agent evidence reproduced during the same verification round:

```text
go vet ./...                                      PASS
go test -count=1 ./...                            PASS
go test -v ./internal/terminal                    PASS; two documented helper/platform skips
go test -run TestRealConPTYThroughWSSCleanupPaths PASS
```

Exact web consumer evidence:

```text
npx vitest run terminal/protocolTerminalAdapter.test.ts  PASS (11/11)
npm test                                               PASS (42/42)
npm run typecheck                                      PASS
npm run lint                                           PASS
npx prettier --check <owned web task files>            PASS
npm run build with exact public origin/WSS env          PASS
```

The public build inputs used the reviewed HTTPS web origin and private WSS
hostname. Values were process-scoped; no private key, credential, token, or
pairing secret was supplied or printed.

Read-only source checks located the web's direct `new WebSocket(url,
subprotocol)` path and the agent's loopback-listener, TLS 1.3, ClientAuth,
Origin/subprotocol, read-limit, authorization, revocation, and pending-output
guards. Repository diff/secret checks are run again on this evidence commit
before handoff.

## Release gaps

- Complete a confirmed live Chrome application flow with stored credential
  reuse, more than eight simultaneous sessions, disconnect/reconnect, and
  cleanup. That action is intentionally outside this read-only review.
- Verify Chrome and Firefox on Android and iPhone, including one-time client
  certificate installation/selection and silent reuse. No physical mobile
  evidence was available.
- Audit the complete current grants/ACLs and device-approval state, then run a
  named non-operator/wrong-tailnet-peer denial.
- Add a controlled external non-tailnet public denial without enabling public
  exposure.
- Run the Go race detector in a toolchain with CGO and a C compiler. The current
  Windows environment had `CGO_ENABLED=0` and no suitable compiler.
- If resource-limit assurance is required beyond deterministic adapter cases,
  run a controlled OS-level exhaustion exercise without exposing or recording
  terminal content.
- Verify an integrated, deployed exact web/agent candidate. The production web
  observed in the broader round was an older ancestor, so this report does not
  equate live transport checks with deployment of the exact web commit.

These gaps prevent a release or physical-browser compatibility claim. They do
not change the first-slice product-review result for the exact commits above.
