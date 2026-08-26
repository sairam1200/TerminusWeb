# Terminus wire contract 0.1

Status: frozen contract candidate for `S01-001`. The immutable task commit, independent review, and Session 06 verification remain separate gates.

## Consumer entry points

- `schema/protocol-0.1.schema.json` is the language-neutral JSON Schema 2020-12 wire envelope and payload contract.
- `state-machine-0.1.json` is the normative connection/session transition table.
- `fixtures/accepted.json` and `fixtures/rejected.json` are canonical consumer fixtures.
- `../security/SECURITY-CONTRACT-0.1.md` defines handshake, pairing, authentication, expiry, origin, and secret-handling semantics.
- `npm run verify` runs the dependency-free reference verifier with Node.js 20 or newer.

Consumers MUST use the schema, transition table, and fixtures together. JSON Schema cannot express direction, byte limits after base64url decoding, sequence history, timing, authentication proof validity, or legal state transitions; those constraints are normative in the transition/security documents and exercised by the fixtures.

## Serialization and transport

- The subprotocol token is `terminus.v0_1`.
- Each WebSocket application message is exactly one UTF-8 JSON text value and one protocol frame. Binary WebSocket messages, fragmented logical JSON values spanning messages, JSON batches, duplicate object member names, non-integer JSON numbers, and non-UTF-8 text are rejected.
- The maximum UTF-8 size of one application message is 65,536 bytes, measured before JSON parsing. A larger message closes with WebSocket code `1009` without parsing.
- JSON object member order is insignificant. Senders SHOULD emit the envelope fields in `version`, `type`, `connectionId`, `sequence`, `payload` order for diagnostics, but receivers MUST NOT depend on order.
- All identifiers are lowercase RFC 9562 UUID version 4 strings. All timestamps are UTC RFC 3339 strings with exactly three fractional digits and a trailing `Z`.
- Byte strings use unpadded RFC 4648 base64url. Non-alphabet characters, padding, non-zero discarded bits, and non-canonical encodings are rejected.

## Envelope, versions, and compatibility

Every frame has exactly these members:

```json
{
  "version": "0.1",
  "type": "hello",
  "connectionId": "10000000-0000-4000-8000-000000000001",
  "sequence": 0,
  "payload": {}
}
```

- `version` is the exact wire major/minor string. Version `0.1` accepts only `0.1`; there is no patch component on the wire.
- The first client frame is `hello` at sequence `0`. Its `supportedVersions` announces all versions the client can speak. A 0.1 receiver selects only `0.1`; otherwise it fails closed with `UNSUPPORTED_VERSION`.
- Unknown versions, message types, fields, and enum values are rejected. No extension field is implicitly ignorable in 0.1.
- A breaking change requires a new wire version and coordinated fixture updates. Adding an optional field is also treated as incompatible until versioned because 0.1 rejects unknown fields.
- Sessions 02 and 03 MUST run the same accepted/rejected fixtures. Session 06 independently reruns them against the exact consumer commits.

## Sequence and replay rules

- Each WebSocket direction has an independent unsigned sequence counter.
- The first application frame sent in each direction is `0`; every later frame is exactly the previous value plus one.
- The maximum is JavaScript's exactly representable integer `9,007,199,254,740,991`. A sender closes cleanly before it would need to increment past that value.
- Duplicate, lower, skipped, negative, fractional, or out-of-range values are fatal. The receiver emits `SEQUENCE_REPLAY` for a value lower than expected and `SEQUENCE_GAP` for a higher value when it can safely form an error, then closes with `1008`.
- Counters reset only on a new WebSocket connection with a new `connectionId`. A reconnect does not reset or weaken session resume-grant replay rules.

## Payload and flow limits

- `terminal_input.data`: at most 16,384 decoded bytes.
- `terminal_output.data`: at most 32,768 decoded bytes.
- Columns and rows: integers from 1 through 1,000.
- At most one terminal session is open or detached for a protocol connection. Version 0.1 does not multiplex sessions.
- Implementations MUST apply bounded outbound queues. The agent closes the terminal session with `BACKPRESSURE_LIMIT` rather than buffering unbounded terminal output.
- Terminal bytes are opaque. The protocol does not log, inspect, normalize, or persist their content.

## Timeout and close rules

Timeouts are measured with a local monotonic clock. Wire timestamps communicate expiry but never replace the monotonic deadline captured when a value is issued.

| Rule | Limit | Result |
|---|---:|---|
| first `hello` | 5 seconds after upgrade | `HELLO_TIMEOUT`, close `1008` |
| one-time pairing code | 120 seconds after issue | generic `PAIRING_FAILED`, close `1008` |
| local pairing decision | 60 seconds after request | generic `PAIRING_FAILED`, close `1008` |
| authentication challenge | 10 seconds after issue | generic `AUTHENTICATION_FAILED`, close `1008` |
| heartbeat send interval | 15 seconds while ready/open | send `heartbeat` ping |
| heartbeat liveness | 45 seconds without any valid inbound frame | `HEARTBEAT_TIMEOUT`, close `1008` |
| detached resume grant | 120 seconds after issue | `RESUME_REJECTED`, keep session detached until its deadline, close connection `1008` |
| authenticated connection | 12 hours | `AUTHORIZATION_EXPIRED`, close session and connection `1008` |
| paired credential | no more than 30 days | require a fresh local pairing |

Schema/protocol violations use close `1002`; invalid UTF-8 uses `1007`; oversized application messages use `1009`; authentication, authorization, replay, timeout, origin, and other policy failures use `1008`. Normal requested closure uses `1000`. Error payloads contain only stable error codes and a fatal flag; they never echo received data or sensitive values.

## Standards verified for this contract

- JSON Schema Draft 2020-12: <https://json-schema.org/draft/2020-12>
- HMAC: RFC 2104, <https://www.rfc-editor.org/info/rfc2104>
- Base64url: RFC 4648 section 5, <https://www.rfc-editor.org/info/rfc4648>
- WebSocket: RFC 6455, <https://www.rfc-editor.org/info/rfc6455>
- UUIDs: RFC 9562, <https://www.rfc-editor.org/info/rfc9562>
- SHA-256: NIST FIPS 180-4, <https://csrc.nist.gov/pubs/fips/180-4/upd1/final>
