# Canonical fixture format

`accepted.json` and `rejected.json` are data, not implementation-specific test code. Each transcript declares initial connection/session states, the next expected sequence in each direction, and ordered frames. Consumers clone each frame before applying a `generate` directive.

Supported deterministic generation directives:

- `{ "field": "payload.data", "decodedBytes": N }` sets the field to the unpadded base64url encoding of `N` zero bytes.
- `{ "wireTrailingSpaces": N }` serializes the frame as compact JSON and appends `N` ASCII spaces before applying the 65,536-byte wire limit.

Checks are ordered: handshake, wire size/UTF-8/JSON syntax, schema, fixed connection ID, direction, sequence, timing/auth/replay semantics, then state transition. A rejected fixture's `expected.code` identifies the first failure and `atFrame` is a zero-based index.

Fixture terminal data is limited to zero/non-text sentinel bytes generated solely for boundary checks or the synthetic non-text sequence `AP8`. It is not terminal plaintext or a command.

Version 0.2 fixtures use `accepted-0.2.json` and `rejected-0.2.json`. Their
`initial.nextOutputOffset` and optional `initial.history` fields are verifier
state, not wire fields. `context.reopenAllowed` models the already-authenticated
credential/device ownership decision without placing a credential or device
identifier in a terminal frame.
