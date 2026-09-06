# S02-006 local/private renderer integration

The user authorized merging all branches and retaining the best conflict/UI behavior. This Session 02 product combines renderer protocol 0.2 / remembered sessions with main local/private connection profiles in isolated recovery/web-integration at baseline 6533cbf.

## Preserved behavior

- Xterm 6.0.0 terminal rendering, OSC guards, English/Swedish UI, themes, mobile controls, Safari lifecycle handling, session fragments, bounded history, New Session retry recovery and browser-valid close codes remain from reviewed renderer d8a9b52.
- Environment profiles and mode selection remain from main e259422. Private mode requires canonical HTTPS origin; local mode requires matching loopback origins and a loopback WSS endpoint. Both use protocol 0.2.
- An active session must be detached before switching modes. Switching clears the old endpoint fragment and remounts the renderer, so history and session identifiers cannot cross endpoint boundaries. Saved profiles contain endpoint configuration only, with environment configuration authoritative. Unavailable browser storage does not prevent an in-memory switch.

## Owner checks

- Existing renderer node_modules copied with robocopy /E into this isolated worktree; npm ls --depth=0 PASS, all package versions match manifest/lockfile including @xterm/xterm 6.0.0 and Next 16.3.3. No dependency API guessed or new dependency added.
- npm test: initial sandbox launch failed before test discovery with Vite spawn EPERM. Approved outside-sandbox rerun exercised tests. After fixing two new-test issues and local adapter label, final result PASS 71/71 tests across 9 files.
- npm run typecheck: PASS, including rerun after final code changes.
- npm run lint: PASS.
- Targeted npx prettier --write on changed web files: PASS. git diff --check: PASS.
- npm run build with synthetic NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT=wss://agent.private.invalid/terminal, WEB_ORIGIN=https://preview.example.invalid, LOCAL_WSS_ENDPOINT=wss://127.0.0.1:4176/terminal, LOCAL_WEB_ORIGIN=http://127.0.0.1:4176: PASS static production output. Variable names all use NEXT_PUBLIC_TERMINUS_ prefix. No connection to these endpoints was made.

## Evidence limits

Tests use labelled adapters, fake WebSockets/IndexedDB, and JSDOM. Independent exact-product review and desktop/mobile real-browser simulation are pending with /root/verification. No real terminal, physical iPhone, deployment, push, live agent, certificate or Tailscale change is claimed. Session 06 integration/release gates remain separate.


## Origin-selection review follow-up

Independent reviewer /root/verification and maker self-review identified inherited main behavior: a configured/saved local profile could be chosen on a private HTTPS page, throwing during adapter construction. The follow-up waits for client hydration, chooses only profiles matching the actual page origin, disables incompatible mode options, and presents accessible configuration guidance if no profile matches. It does not fall back to a simulated terminal or relax endpoint validation. Two regressions exercise the real adapter constructor (no adapterFactory) for mismatched configuration and valid local fallback from an incompatible preferred private mode.

Final follow-up owner tests: npm test PASS 73/73 across 9 files; typecheck PASS; lint initially caught an unescaped apostrophe in the new guidance, corrected and rerun PASS. Follow-up production build and independent browser outcome are recorded in the status handoff.


## Independent browser focus follow-up

Reviewer /root/verification exercised the actual UI on desktop and mobile simulation and found shortcut buttons retained focus. The shortcut-only helper now restores focus to xterm for the protocol renderer and the composer for simulation, without changing typing or paste handlers. Unit regression covers both paths. Final cumulative owner npm test PASS 74/74 across 9 files; npm run lint PASS; no-endpoint npm run build PASS including its TypeScript gate and static generation. No-endpoint production output supports the final independent simulation browser run.
