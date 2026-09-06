# Canonical fixture format

`accepted.json` and `rejected.json` are data, not implementation-specific test code. Each transcript declares initial connection/session states, the next expected sequence in each direction, and ordered frames. Consumers clone each frame before applying a `generate` directive.

Supported deterministic generation directives:

- `{ "field": "payload.data", "decodedBytes": N }` sets the field to the unpadded base64url encoding of `N` zero bytes.
- `{ "wireTrailingSpaces": N }` serializes the frame as compact JSON and appends `N` ASCII spaces before applying the 65,536-byte wire limit.

Checks are ordered: handshake, wire size/UTF-8/JSON syntax, schema, fixed connection ID, direction, sequence, timing/auth/replay semantics, then state transition. A rejected fixture's `expected.code` identifies the first failure and `atFrame` is a zero-based index.

Fixture terminal data is limited to zero/non-text sentinel bytes generated solely for boundary checks or the synthetic non-text sequence `AP8`. It is not terminal plaintext or a command.

Version 0.2 fixtures use `accepted-0.2.json` and `rejected-0.2.json`. Their
`initial.nextOutputOffset` and optional `initial.history` fields are verifier
state, not wire fields. `context.reopenDecision` independently models allowed,
unknown, wrong-credential, wrong/missing-source-device, already-attached, and
closed-ID decisions without placing credential or device identifiers in a
terminal frame. Every denial has the same wire result.

`accepted-0.2.json.retentionCases` is the canonical internal budget model. Its
array order is oldest-to-newest retained history. Appends first enforce the
262,144-byte target-session limit and then evict globally oldest bytes until
the 16,777,216-byte agent budget is met. Eviction marks truncation and never
closes a running session or establishes a session-count limit.
The uniform 64-session case reaches the global limit using only valid
per-session states; the verifier rejects any seeded state that already exceeds
either limit.

`accepted-0.2.json.pageLifecycleCases` fixes browser fragment behavior around
**New Session**: replace only after close acknowledgment plus a fresh
`session_opened`; preserve the old fragment on close/open failure; and treat an
old ID whose close succeeded as no longer reopenable.
