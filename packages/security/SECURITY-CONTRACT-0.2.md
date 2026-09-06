# Terminus security contract 0.2

Status: remembered-session contract candidate for `S01-005`. This version
preserves the direct private-WSS, mTLS, exact-Origin, local-approval, protected
credential, no-relay, and no-backdoor boundaries of 0.1.

## Unchanged boundary

The browser connects directly to the user-owned, non-elevated Windows agent
over the approved Tailscale-private `wss://` path. Vercel serves assets only.
Neither Vercel nor a present/future control plane receives terminal frames,
terminal history, pairing material, credentials, or a decryption key. Funnel,
public/LAN listeners, insecure downgrade, wildcard Origin matching, and
terminal relay through Vercel remain forbidden.

The HTTP upgrade requires exact configured HTTPS `Origin` and WebSocket
subprotocol `terminus.v0_2`. Tokens, credentials, session IDs, pairing codes,
and terminal bytes never appear in the URL path, query, cookies, headers, or
subprotocol. The page uses a URL fragment for its non-secret session ID because
the fragment is not transmitted in the HTTP request.

## Pairing and authentication

The 0.1 pairing ceremony, protected browser/Windows credential storage,
constant-time comparisons, 120-second one-time code, 60-second local approval,
10-second challenge, 30-day maximum credential lifetime, revocation, and
rate-limit requirements remain normative. A successfully stored credential is
not replaced or re-paired merely because the consumer upgrades to 0.2.

Authentication is HMAC-SHA-256 over:

```text
ASCII("Terminus/0.2/auth") || 0x00 ||
ASCII(lowercase connectionId) || 0x00 ||
ASCII(lowercase challengeId) || 0x00 ||
challengeBytes
```

All other encoding, challenge uniqueness, single-use, expiry, proof, failure,
and constant-time rules are identical to 0.1. Canonical vectors are in
`auth-vectors-0.2.json`.

## Session identifiers are not capabilities

- Each `xxxx-xxxx-xxxx` session ID encodes 60 independent CSPRNG bits using
  canonical lowercase Crockford Base32. It is easy to read but is not
  sequential, user-selected, derived from terminal content, or an
  authentication secret.
- The agent stores the owning `credentialId` and resolved private source-device
  identity beside the in-memory session. It
  atomically accepts `reopen_session` only after successful authentication by
  that same unexpired, unrevoked credential and only while the session is
  globally detached.
- Knowledge of an ID, possession of another paired credential, Tailscale
  reachability, or possession of the client TLS certificate alone cannot
  reopen it. No session listing, prefix lookup, fuzzy matching, ownership
  transfer, or control-plane override exists.
- Syntactically valid unknown, wrong-owner, already-attached, ended, and
  concurrently claimed IDs have the identical fatal
  `SESSION_REOPEN_REJECTED` result and timing should be padded to the same local
  decision class. The response never reveals whether the ID exists.
- In addition to pairing/authentication throttles, the agent allows at most 20
  rejected reopen attempts per authenticated credential and source-device
  identity in five minutes, then applies a five-minute monotonic cooldown.
  Successful reopens do not reset a currently active cooldown.

## Volatile history boundary

- For each running session the agent retains at most 262,144 latest terminal
  output bytes, subject to a 16,777,216-byte agent-wide history budget, plus
  offsets in volatile process memory. Global pressure evicts oldest history
  bytes but does not terminate a running session or create a fixed session
  count. It never retains input
  separately and never interprets, indexes, compresses, hashes, logs, exports,
  or writes those bytes to disk, credential storage, crash reports, telemetry,
  backups, Vercel, or a control plane.
- The browser renders live and replay bytes but persists none of them in
  IndexedDB, Web Storage, Cache Storage, the service worker, URLs, clipboard
  helpers, logs, analytics, or crash reporting. Only the protected credential,
  non-secret client/session metadata, and the fragment locator may survive a
  page lifecycle.
- Terminal emulation for replay and live output disables content-triggered
  clipboard writes, navigation, notifications, and external resource loads.
  Replaying bytes must not re-trigger browser side effects.
- Replay ownership is claimed and its end offset captured atomically. Exactly
  one connection may attach. The snapshot is sent contiguously before later
  live output; gaps, overlaps, duplicates, overflow, wrong-session frames, or
  history-end mismatch fail closed with `OUTPUT_OFFSET_INVALID`.
- Replay backpressure closes only the claiming connection and returns the
  still-running session to detached state when containment is intact. It never
  creates a second unbounded pending buffer. A late close from an older
  connection cannot affect the newer atomic owner; explicit close, revocation,
  process exit, and shutdown win and clean up exactly once.
- While attached, the existing bounded outbound queue applies. While detached,
  the fixed history ring drops oldest output and marks the next replay
  `truncated`; it cannot grow without bound. A single decoded history/output
  chunk is at most 32,768 bytes.
- Removing a session drops all references to its ring. The implementation must
  not promise cryptographic erasure from managed/runtime memory, swap, or crash
  dumps; host-level memory and crash-dump protection remain an operating-system
  responsibility and plaintext durability is explicitly unsupported.

## Lifecycle and cleanup

- Graceful detach, transport loss, and connection authorization expiry detach a
  still-running terminal without a short reconnect deadline. Reopen always
  requires a fresh successful connection authentication by the owner
  credential; it never repeats pairing solely for reconnect.
- Explicit `close_session` with `user_request` or `new_session`, credential
  expiry/revocation, process exit, agent shutdown/restart, containment loss,
  protocol failure requiring teardown, and backpressure/resource failure close
  the ConPTY process tree and discard the history ring. A closed ID cannot be
  reopened.
- Credential revocation closes attached and detached sessions owned by that
  credential. Authentication/reopen races are atomically revalidated before
  attachment, just as terminal-creation races are revalidated before
  registration.
- No fixed numeric aggregate session cap is added. Independent running and
  detached sessions remain accounted for until deterministic cleanup. Genuine
  CSPRNG, adapter, ConPTY, offset-exhaustion, or system-resource failure fails
  generically and does not disclose other session metadata.

## Logging and allowed metadata

The 0.1 secret/plaintext denylist remains in force and now also forbids
terminal history/snapshots, replay chunks, and any content-derived diagnostics.
Allowed local metadata remains limited to timestamps, stable event/error codes,
byte counts, durations, close codes, non-secret identifiers, Origin decisions,
and Tailscale device identity when available. Exported identifiers should be
keyed-hashed with a local-only key.
