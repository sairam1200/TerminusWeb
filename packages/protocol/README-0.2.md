# Terminus wire contract 0.2

Status: contract candidate for `S01-005`. Owner review and Session 06
verification remain separate gates.

## Consumer entry points

- `schema/protocol-0.2.schema.json`: closed JSON Schema 2020-12 frames.
- `state-machine-0.2.json`: connection, reopen, replay, and close transitions.
- `fixtures/accepted-0.2.json` and `fixtures/rejected-0.2.json`: canonical
  consumer transcripts.
- `../security/SECURITY-CONTRACT-0.2.md`: credential ownership, lifecycle,
  history privacy, and abuse rules.
- `npm run verify`: verifies frozen 0.1 and candidate 0.2 independently.

## Compatibility and transport

- The WebSocket subprotocol is exactly `terminus.v0_2`; every frame version is
  exactly `0.2`. Frames and subprotocols from 0.1 and 0.2 are never mixed.
- The serialization, 65,536-byte UTF-8 frame limit, UUID, timestamp,
  base64url, sequence, direction, heartbeat, Origin, and WSS rules from 0.1
  remain in force unless this contract explicitly replaces them.
- Pairing/authentication use the 0.2 security contract and domain separator.
  Stored credentials may be reused after the coordinated consumer upgrade;
  no new pairing ceremony is required solely because the wire version changes.
- Each authenticated WebSocket carries at most one terminal. There is no fixed
  numeric application-policy cap across connections.

## Simple session IDs and private page routing

- The agent generates each ID from 60 cryptographically random bits and
  Crockford Base32, formatted as canonical lowercase `xxxx-xxxx-xxxx`. Collision
  checks occur before terminal creation. Generation retries at most eight
  times, then fails with `SESSION_OPEN_FAILED`.
- The ID is a non-secret locator. It never grants access and is never accepted
  without successful credential authentication and exact ownership match.
- The web route is the fragment `#/s/{sessionId}`. Fragments are not part of
  HTTP requests, so Vercel does not receive the session ID. IDs, credentials,
  or grants are forbidden in query strings, paths, cookies, or analytics.
- A root page without an ID opens a new terminal. After `session_opened`, the
  client replaces the fragment with the returned canonical ID. Reloading that
  fragment authenticates and sends `reopen_session`; it does not open another
  terminal. Two independent root pages receive independent IDs.
- **New Session** closes the current session with reason `new_session`, waits
  for `session_closed`, opens a fresh authenticated connection, and replaces
  the fragment only after a new `session_opened`. The old ID is no longer
  reopenable. Failure before the replacement leaves the old fragment visible
  with an explicit closed/error state; it never silently aliases two sessions.

## History and offsets

- Every `terminal_output` contains the zero-based byte `offset` of its first
  decoded byte. For one session, offsets are contiguous and monotonically
  increase up to `9,007,199,254,740,991`.
- The agent retains at most 262,144 latest output bytes for each running
  session and at most 16,777,216 history bytes across the agent in volatile
  memory. Global pressure evicts oldest history bytes, never a running session
  and never imposes a session-count limit. It may discard old bytes and then sets
  `history_begin.truncated` true. It never writes terminal bytes to persistent
  storage or logs.
- Reopen atomically attaches the globally detached session and captures
  `[startOffset,endOffset)`. After `session_reopened`, the agent sends exactly
  one `history_begin`, zero or more contiguous `history_chunk` frames of at
  most 32,768 decoded bytes, then one matching `history_end`. The browser
  clears its terminal before applying the snapshot. Output captured after the
  snapshot is queued behind `history_end` and continues at its exact offset.
- If a replay connection stalls or its bounded queue fills, that connection is
  closed and the still-running shell returns to detached state when safe; the
  replay path never accumulates an unbounded pending copy. Explicit close,
  revocation, process exit, or shutdown still wins the race and destroys the
  session.
- `truncated` false requires `startOffset` zero. A true value tells the browser
  to show a non-content-bearing history-truncated notice. It must not invent
  missing bytes or treat a truncated snapshot as complete process history.
- The browser may render replay bytes but must not persist them in IndexedDB,
  local/session storage, Cache Storage, service workers, URLs, logs, analytics,
  crash reports, or Vercel/control-plane requests.
- Replay and live rendering must disable terminal escape-sequence side effects
  such as clipboard writes, navigation, notifications, or external resource
  loads. Version 0.2 still defines no clipboard transport.

## Lifecycle and failure behavior

- Graceful `detach`, unexpected transport loss, and 12-hour connection
  authorization expiry detach a running session. Reauthentication then reopens
  it with the same stored credential and session ID without pairing.
- The session and its retained history exist until explicit close/New Session,
  credential expiry or revocation, process exit, agent shutdown/restart,
  protocol containment loss, or backpressure/resource failure. Agent restart
  is intentionally not durable history recovery.
- Unknown IDs, wrong credentials, already attached sessions, ended sessions,
  and concurrent losers all return only fatal `SESSION_REOPEN_REJECTED` and
  close `1008`. No session-listing operation exists.
- The retained session is also bound to the non-empty source-device identity
  returned by the required private-device resolver; a wrong or missing binding fails
  with the same generic result.
- Attached outbound queues remain bounded and close with
  `BACKPRESSURE_LIMIT`. Detached history overwrites its oldest bytes within the
  fixed ring and reports truncation; it never grows without bound.
- A late disconnect from an older connection cannot detach or close a session
  after a newer connection has atomically attached it. Close, revoke, process
  exit, and shutdown are exactly-once terminal operations across reopen races.
- `terminal_input` remains at most 16,384 decoded bytes. `terminal_output` and
  `history_chunk` remain at most 32,768 decoded bytes. Offset mismatch or
  overflow is fatal `OUTPUT_OFFSET_INVALID`.
