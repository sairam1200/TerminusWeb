# S01-005 handoff to Session 02: remembered session pages

Immutable source-owned request. Read with `git show` from the commit containing
this file.

Implement queue task `S02-005` only in Session 02-owned paths. Consume exact
cumulative protocol/security product
`f9a70299974734c3eeb920697d2dfa4717148a9a` and Session 01 status handoff
`14a613b` from branch `session/01-architecture`.

Required outcomes:

- Upgrade the web consumer coherently to protocol/subprotocol 0.2; never accept
  mixed 0.1/0.2 frames.
- Give each root page a fresh server-issued `xxxx-xxxx-xxxx` ID and put it only
  in `#/s/{id}` after `session_opened`. A reload of that fragment authenticates
  with the stored credential and reopens that ID without pairing.
- Clear the terminal at `history_begin`; validate and render contiguous history
  chunks before live output; show a content-free truncation notice; fail closed
  on gaps, overlaps, wrong IDs, or overflow.
- Do not persist terminal output/history in IndexedDB, Web Storage, Cache
  Storage, service-worker caches, URLs, logs, analytics, or error artifacts.
  Keep replay/live terminal side effects such as clipboard, navigation,
  notifications, and external loads disabled.
- **New Session** waits for old-session closure, then opens a fresh authenticated
  connection and replaces the fragment only after the new `session_opened`.
  Preserve the old fragment and show an explicit error if close/open fails.
- Add deterministic tests for the canonical page lifecycle cases, reload,
  simultaneous-ID rejection, stored-credential reuse, offsets/truncation,
  persistence scans, accessible compact ID/New Session UI, and desktop/mobile
  behavior. Do not claim physical-browser evidence from test doubles.

Use the two-commit owner handoff and a named independent reviewer. Do not push,
deploy, mutate certificates/network/browser state, or edit contracts.
