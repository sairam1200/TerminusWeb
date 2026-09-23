# S02-006 terminal quality follow-up (2026-09-23)

User authorized the reviewed Unicode, paste and accessibility recommendations.
Scope: the existing Session 02 web renderer/adapter task, with no wire contract,
agent, deployment, endpoint, credential, persistence or networking changes.
Branch: `session/02-web-terminal-quality` (the canonical branch is occupied by
another worktree). Queue transitions remain Session 01-owned.

## Behavior

- Each adapter streams UTF-8 decoding across live and replay frames, including
  the replay-to-live boundary. New connections/history reset decoder state;
  session close flushes incomplete final bytes. Independent adapters do not
  share decoder state.
- Composer paste replaces the selected text locally and requires explicit
  submission. Multiline Enter edits the draft; Send submits. IME confirmation
  Enter does not submit. Plain single-line keyboard submission remains.
- Composer and large native xterm input use a bounded 256 KiB UTF-8 operation,
  split into complete-character frames within the existing 16 KiB wire limit.
  Sending waits for buffered transport capacity, at most five seconds per
  blocked chunk. Concurrent paste is rejected; ordinary input cannot interleave
  while paste sends; Control C cancels remaining chunks. Disconnect/replacement
  interrupts rather than forwarding queued text into another session.
- Partial sends are never automatically retried. The composer retains the draft
  and shows a content-free warning; bytes already sent cannot be recalled.
- Optional, bilingual screen-reader support enables xterm's accessibility DOM.
  The outer terminal container is a labelled region rather than a second live
  log, avoiding duplicate announcements. The setting is page-local, as are the
  existing visual settings, and does not recreate the terminal.

## Dependency and contract evidence

- Installed `@xterm/xterm` 6.0.0 and its `typings/xterm.d.ts` verify
  `screenReaderMode`, asynchronous writes and raw-byte behavior.
- Installed `src/browser/Clipboard.ts` confirms native xterm paste preprocessing
  and bracket handling remain xterm-owned. The existing composer is raw input.
- Existing protocol 0.2 consumer constants and canonical fixture tests remain
  unchanged; no new frame, ACK, error code or relaxed budget is introduced.
- The installed MCPmarket terminal-integration skill supplied review themes;
  its SwiftTerm/Apple-specific architecture and terminal logging advice were
  not adopted.

## Commands and results

All web commands ran from `apps/web` unless noted.

- `node node_modules/vitest/vitest.mjs run`: PASS, 164 tests / 18 files before
  the final additional partial-send regression.
- Final `node node_modules/vitest/vitest.mjs run terminal/protocolTerminalAdapter.test.ts components/TerminalShell.test.tsx`:
  PASS, 75 tests / 2 files, including that additional regression.
- `node node_modules/typescript/bin/tsc --noEmit`: PASS.
- `node node_modules/eslint/bin/eslint.js .`: PASS after removing temporary
  browser scripts from lint discovery; no product warnings.
- Targeted `node node_modules/prettier/bin/prettier.cjs --check` on all six
  changed source/test files: PASS.
- `npm run build`: PASS. Repeated on final CSS with public
  `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT=wss://sai.tailf8dcea.ts.net/terminal` and
  `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN=https://terminus-web.vercel.app`; final HTML
  contains both established public values. No environment file was modified.
- `git diff --check`: PASS.
- Initial sandboxed Vitest could not start Vite (`spawn EPERM`); approved
  execution outside that sandbox passed. This was not a failing test.

## Browser evidence and limits

Playwright CLI session `terminal-quality`, Chrome, loopback production build
on port 3187. A synthetic WebSocket was injected at the explicit transport
boundary; it never connected to Windows, Tailscale or a real shell. The actual
React UI, adapter, Web Crypto/IndexedDB and installed xterm renderer ran.

`playwright-cli -s=terminal-quality run-code --filename ...` scripts exercised
synthetic pairing/authentication, per-byte Unicode output, xterm accessibility
DOM content, selection-aware staged multiline paste, Enter behavior, ordered
large paste within frame limits, English/Swedish settings, and 1280x800 and
390x844 layouts without horizontal overflow. Final build rerun passed; browser
console reported 0 errors and 0 warnings. Masked screenshots were visually
inspected. Temporary scripts and images are local-only under `.playwright-cli`.

No physical iPhone, NVDA/VoiceOver speech, real ConPTY, live pairing, or private
network check is claimed. Interrupted native bracketed paste can be partial;
the UI warns to inspect the shell before retrying. Existing bounded history
still cannot restore bytes discarded before its retained starting offset.
Full terminal flow control/performance tuning and scrollback search remain
outside the accepted first implementation recommendation.

Independent review and immutable product SHA are recorded in Session 02 status.
