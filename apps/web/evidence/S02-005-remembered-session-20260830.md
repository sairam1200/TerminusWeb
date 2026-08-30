# S02-005 remembered-session web evidence

Date: 2026-08-30

## Exact inputs

- Queue and request source: `789397bac3c11fed56a1a9a5784fe5ee551138c2`.
- Cumulative protocol/security product: `f9a70299974734c3eeb920697d2dfa4717148a9a`.
- Session 01 status handoff: `14a613b` on `session/01-architecture`.
- Wire version and WebSocket subprotocol: `0.2` and `terminus.v0_2` only.

The canonical consumer test reads the accepted, rejected, and authentication
fixtures directly from the exact protocol product with `git show`. The
protocol verifier in the Session 01 worktree was byte-identical to the relevant
paths at the product SHA and reported 23 transcript and 32 fixture checks plus
the positive and negative authentication vectors passing.

## Implemented behavior

- A root connection uses `open_session`; only the server's canonical
  `session_opened` ID is written to `#/s/{id}` with `history.replaceState`.
- A canonical fragment is authenticated with the existing stored credential
  and sent as `reopen_session`. `session_reopened` must match that exact ID.
- Replay clears xterm at `history_begin`, renders only contiguous chunks, and
  enters live mode only after a matching `history_end`. Gaps, overlaps, wrong
  IDs, invalid ranges, and safe-integer overflow fail closed with
  `OUTPUT_OFFSET_INVALID`.
- A truncated replay shows the content-free notice “Earlier output is not
  available.”
- **New Session** sends `close_session` with `new_session`, waits for the
  matching closure, creates a fresh authenticated connection, and updates the
  fragment only after the new `session_opened`. Either close-phase or
  open-phase failure rejects the operation, retains the old fragment, and
  renders an explicit alert.
- OSC 8, 9, 52, and 777 handlers consume terminal-controlled navigation,
  notification, clipboard, and related browser side effects.
- The compact session ID and New Session control retain the existing responsive
  desktop/mobile shell and English/Swedish interface.

The IndexedDB database keeps its pre-existing legacy namespace so an already
paired browser does not lose its non-extractable signing key during the wire
upgrade. That name is not a wire-version fallback: every frame, HMAC domain,
and requested subprotocol is 0.2. Runtime and source-level tests confirm the
database contains credential/non-secret client metadata only, while terminal
history/output is absent from IndexedDB, Web Storage, Cache Storage, service
worker caches, fragments, and rendered error text.

## Deterministic evidence

- `node packages/protocol/scripts/verify-contract-0.2.mjs` in the exact-content
  Session 01 worktree: PASS — 23 transcripts, 32 fixtures, one positive auth
  vector, and four negative auth mutations.
- Focused Vitest after the final lifecycle assertions: PASS — 32/32 across the
  terminal component and direct WebSocket adapter suites.
- Full `npm test`: PASS — 60/60 across 9 files.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- Targeted `npx prettier --check ...`: PASS for every changed TypeScript, TSX,
  CSS, and test file.
- Configured `npm run build` with the fixed production web Origin and private
  WSS endpoint: PASS — Next.js 16.3.3 static production build.
- `git diff --check`: PASS before the product commit.

Canonical fixtures cover unknown, concurrent/in-use, wrong-credential,
wrong-source-device, and closed-by-New-Session reopen rejection with the same
generic `SESSION_REOPEN_REJECTED` result. The adapter test separately proves a
fresh store/adapter sharing the same IndexedDB profile reuses the credential,
does not enter pairing or send `pairing_request`, and sends the remembered ID
in `reopen_session`.

The first independent review of product `cdde0dfbed9cf423c471d4bd0e25a3b9dd672bbe`
found one Medium recovery issue: a rejected close send could leave internal and
UI state out of sync, while a retry after acknowledged closure could target the
destroyed old ID. The cumulative follow-up restores the attached state and
contract-machine snapshot when close was not queued, and records the
acknowledged-close case in the UI so Retry requests a fresh root session. New
adapter and component regressions prove both retry paths while retaining the
old fragment until a new `session_opened` arrives.

## Scope and limitations

All product changes are under `apps/web/**`. No contract, backend, Windows
agent, certificate, Tailscale, browser, deployment, or live endpoint state was
mutated. Tests use canonical fixtures, fake IndexedDB, JSDOM, and a labelled
WebSocket test port; they are deterministic integration evidence, not a claim
of physical mobile-browser or live agent verification. Session 06 must verify
the integrated exact commits before release.
