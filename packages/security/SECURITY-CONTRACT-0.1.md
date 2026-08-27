# Terminus security contract 0.1

Status: frozen first-slice contract candidate for `S01-001`. This contract uses established primitives; it does not define a new cipher, hash, MAC, random generator, or key-derivation algorithm.

## Security boundary

The browser connects directly to the user-owned Windows agent over an authenticated `wss://` endpoint reachable only through the approved Tailscale-private path. Vercel serves web assets and is never on the terminal WebSocket path. Tailscale device admission and policy reduce network reachability but do not replace the application pairing and authentication below.

Version 0.1 relies on correctly validated WebSocket TLS for confidentiality and integrity in transit. It does not add application-layer end-to-end encryption above WSS. A future metadata control plane must remain unable to decrypt terminal traffic; selecting a standard application-layer key agreement for that future topology is explicitly unresolved and requires security review, test vectors, and a protocol version change before such a control plane can join any terminal flow.

## WebSocket handshake requirements

The agent rejects the HTTP upgrade before accepting application frames unless all conditions hold:

1. The listener origin remains loopback and an explicitly approved private Tailscale serving layer terminates HTTPS/WSS. No public listener, LAN wildcard listener, Funnel, public SSH, or reverse proxy through Vercel is allowed.
2. TLS certificate and hostname validation succeeds for the configured private endpoint. The browser never offers a click-through or insecure downgrade.
3. The `Origin` header is present and exactly equals one configured serialized HTTPS origin. Wildcards, suffix matching, substring matching, `null`, non-HTTPS origins, paths, userinfo, and unconfigured preview origins are rejected with HTTP 403. The `hello` body is not a substitute for the handshake header.
4. The selected WebSocket subprotocol is exactly `terminus.v0_1`. Tokens, pairing codes, credentials, and resume grants never appear in the URL, query string, cookies, headers, or subprotocol value.
5. The first application frame arrives within five seconds and is a valid `hello` at client sequence zero.

## Random values and encodings

- Pairing codes are 16 bytes (128 bits) from the operating system cryptographically secure random generator and encoded as 22 unpadded base64url characters.
- Credential secrets, authentication challenges, and resume grants are independently generated 32-byte (256-bit) values and encoded as 43 unpadded base64url characters.
- UUIDs identify objects but are never treated as secrets or authentication evidence.
- Random outputs are never reused. There is no deterministic fallback if secure randomness fails; pairing/authentication/resume generation fails closed.
- Decoders require canonical unpadded RFC 4648 base64url and reject malformed or non-canonical input before use.

## Pairing ceremony

1. The non-elevated agent generates a one-time pairing code and displays it locally as a QR or equivalent out-of-band transfer. It records a monotonic 120-second deadline.
2. After an allowed-origin WebSocket `hello` without a known `credentialId`, the browser may send one `pairing_request` containing that code. The code must never be logged, persisted by the web app, or retried on another connection.
3. The agent consumes the code on the first syntactically valid attempt, whether the attempt succeeds, times out, or is denied. Comparisons are constant-time. Failed responses use only `PAIRING_FAILED` so they do not reveal existence, expiry, or approval state.
4. A local user confirmation is mandatory and expires after 60 seconds. The prompt identifies the exact browser origin and the non-secret `clientInstanceId`; network reachability alone cannot approve pairing.
5. On approval the agent generates an independent 32-byte credential secret, a UUIDv4 `credentialId`, and an expiry no more than 30 days away. `pairing_result` returns them once on the same WSS connection. The pairing code is not a key and is never used in HMAC.
6. The browser imports the credential into origin-bound protected storage and removes any transient raw copy. It must not use `localStorage`, URL state, analytics, crash reports, console output, or service-worker caches. The agent protects its credential record with the Windows user/machine protected secret facility appropriate to its service identity. Exact storage APIs belong to the consumer implementation and require consumer-side evidence.
7. Revocation deletes the agent-side credential and invalidates its active authorizations and resume grants. No platform administrator or control plane has a copy, recovery key, or silent bypass.

## Authentication construction

Authentication is a standard HMAC-SHA-256 challenge-response using RFC 2104 HMAC and NIST SHA-256.

1. A paired browser supplies its non-secret `credentialId` in `hello`.
2. After `hello_ack`, the agent looks up an unexpired, unrevoked credential, generates a fresh 32-byte challenge and UUIDv4 `challengeId`, binds both to the current `connectionId`, and records a monotonic 10-second deadline. It sends `auth_challenge`.
3. Both sides form exactly these bytes:

```text
ASCII("Terminus/0.1/auth") || 0x00 ||
ASCII(lowercase connectionId) || 0x00 ||
ASCII(lowercase challengeId) || 0x00 ||
challengeBytes
```

`connectionId` and `challengeId` are their 36-character lowercase UUID strings without braces. `challengeBytes` are the 32 decoded bytes, not their base64url text.

4. The browser computes `HMAC-SHA-256(credentialSecret, bytesAbove)` and sends the 32-byte result as unpadded base64url `proof` in `auth_response`.
5. The agent rejects a mismatched ID, connection, credential, expired deadline, repeated response, or invalid proof with the same generic `AUTHENTICATION_FAILED`. It compares the decoded 32-byte proof in constant time, consumes the challenge on the first response, and closes with `1008` after failure.
6. On success the agent sends `auth_result` and records a maximum 12-hour authorization deadline tied to the connection and credential. Authorization does not survive connection loss. Authentication is required again before a detached session can resume.

Canonical proof inputs and outputs are in `auth-vectors-0.1.json`. Implementations MUST pass them without substituting text encodings or padded base64.

## Sequence, replay, and resume

- The strictly increasing per-direction counters in the wire contract reject repeated and reordered application frames. Counter state is per connection and is not persisted.
- Every authentication challenge is unique, connection-bound, single-use, and consumed on success or failure. A captured response cannot authenticate a different connection or challenge.
- `session_detached` creates a fresh 32-byte resume grant bound server-side to exactly one `credentialId` and one `sessionId`, with a 120-second monotonic deadline. The grant is returned once, retained only in memory by both endpoints, and never persisted.
- Resume occurs only on a new successfully authenticated connection for the same credential. The agent atomically consumes the grant before attaching. Reuse, wrong credential/session, expiry, or concurrent redemption returns only `RESUME_REJECTED` and closes that connection; it does not extend the detached session deadline.
- When the grant expires or the agent cannot preserve process containment, it terminates the shell and cleans all ConPTY resources. A transport disconnect without a previously issued valid grant is not resumable.

## Failure and logging rules

- Terminal process admission is capped at eight concurrent sessions across the
  agent. The reservation is atomic, detached sessions retain their reservation,
  and a rejected ninth request must not create a ConPTY process. Capacity
  failures use the existing generic `SESSION_OPEN_FAILED` result so they do not
  disclose session identifiers or terminal metadata. Closing, expiry,
  revocation, connection loss, and agent shutdown release every reservation
  only after the corresponding contained process cleanup completes.
- Parsing, schema, direction, state, version, size, timing, origin, pairing, authentication, authorization, and replay checks fail closed according to the wire contract.
- Rate limits are required in addition to high-entropy pairing codes: at most five failed pairing/authentication attempts per source device identity in five minutes, followed by a five-minute monotonic cooldown. Rate-limit metadata contains counts and device/credential identifiers only.
- Logs and structured errors never contain terminal bytes, commands, clipboard data, pairing codes, credential secrets, proofs, challenges, resume grants, tokens, private keys, WebSocket payloads, or reusable hashes of those values.
- Allowed metadata is limited to timestamp, event code, agent/client/credential/session identifiers, origin decision, Tailscale device identity when available, byte counts, close code, duration, and success/failure. Identifiers should be minimized or keyed-hashed in exported telemetry; the key stays local.
- Clipboard transport is not defined in 0.1. Any received clipboard-like message is an unknown type and is rejected.

## Explicitly unresolved, version-gated work

These are not silently filled in by implementations:

- Application-layer end-to-end encryption and forward-secret key agreement for any future control-plane-assisted commercial topology.
- Credential synchronization, recovery, multi-device delegation, and administrator workflows.
- A packaging/signing/update trust root for the Windows agent.

None is permitted in the first private direct-WSS slice. A proposal must use reviewed standard constructions, add canonical vectors and abuse cases, and version the contract before consumer changes.
