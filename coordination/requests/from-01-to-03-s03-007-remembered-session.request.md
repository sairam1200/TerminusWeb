# S01-005 handoff to Session 03: remembered sessions and history

Immutable source-owned request. Read with `git show` from the commit containing
this file.

Implement queue task `S03-007` only in Session 03-owned paths. Consume exact
cumulative protocol/security product
`f9a70299974734c3eeb920697d2dfa4717148a9a` and Session 01 status handoff
`14a613b` from branch `session/01-architecture`.

Required outcomes:

- Upgrade the endpoint coherently to protocol/subprotocol 0.2; never accept
  mixed 0.1/0.2 frames. Preserve stored credentials without re-pairing solely
  because of the version upgrade.
- Generate canonical `xxxx-xxxx-xxxx` IDs from 60 CSPRNG bits with collision
  checks before terminal creation. IDs are locators, never authorization.
- Bind each session to the authenticated credential and required resolved
  private source-device identity. Atomically allow exactly one reopen owner;
  unknown/wrong credential/wrong or missing device/busy/closed cases return the
  same generic rejection.
- Retain only output bytes in volatile memory: 262,144 bytes per running
  session and 16,777,216 agent-wide. Globally evict oldest history bytes under
  pressure without closing sessions or adding a fixed session-count cap.
- Replay one offset-contiguous snapshot before live output. Prevent unbounded
  replay buffering and old-disconnect/new-owner races; close/revoke/process
  exit/shutdown must win exactly once. Explicit close/New Session destroys the
  old ID/history; transport loss and authorization expiry detach.
- Add deterministic barrier/concurrency, canonical fixture, budget/eviction,
  ID collision/format, generic denial, backpressure, revocation, real Windows
  ConPTY replay, cleanup, and secret/plaintext tests. Preserve S03-006 stalled
  open behavior when no session ID has yet been issued.

Use the two-commit owner handoff and a named independent reviewer. Do not start
the live host, print a pairing code, change certificates/Tailscale, push,
deploy, or edit contracts.
