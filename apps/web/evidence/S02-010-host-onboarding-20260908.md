# S02-010 host onboarding evidence

The existing single-host client already supports separate browser credentials.
This task explains fresh single-use onboarding and remembered authorization in
English and Swedish, documents certificates/Tailscale and host-store persistence,
and adds a separate-browser regression without changing runtime authorization.

Inputs: queue `39a8fb1`, S02-009 product
`f96996e8a3e3fefe656945141b6ec3409738d898`, reviewed handoff
`c12c8adee59f4cabf6abf1d0d1f76981a9d693be`. The baseline web tree matched
integration `ee3705886f7ecbe47f4b5a0184047e7191f8e297`.

The added regression uses separate fake IndexedDB factories and mock WebSockets.
Each browser receives a different credential and stable browser ID. After both
pair, fresh adapters reuse their own stored keys, and independently calculated
Node HMAC proofs confirm browser B did not overwrite browser A's credential.
Both connect to the same configured endpoint and receive different running
session IDs. Neither reload emits another pairing request. This is deterministic
client-boundary evidence; mock authentication success does not prove agent
acceptance, host approval, networking, or actual ConPTY execution.

Commands from `apps/web`:

- `npx prettier --write components/TerminalShell.tsx terminal/protocolTerminalAdapter.test.ts README.md`: PASS.
- `npx vitest run terminal/protocolTerminalAdapter.test.ts`: initial sandbox attempt failed before discovery with `spawn EPERM`; authorized rerun PASS, 25 tests.
- `npm test`: PASS, 16 files / 134 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, no warnings.
- `npx prettier --check components/TerminalShell.tsx terminal/protocolTerminalAdapter.test.ts README.md`: PASS.
- `git diff --check`: PASS.
- `npm run build`: PASS, Next.js 16.3.3 / ten static pages. Process-only configuration set `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`, `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`, and `NEXT_PUBLIC_TERMINUS_CONNECT_MODE` to the established production private endpoint/origin/mode; both local-profile variables were unset. No environment files were modified.

Installed package scripts, the existing IndexedDB credential-store interface,
WebSocket test double, and Node crypto supplied API provenance. No dependency,
wire contract, endpoint, browser storage format, secret configuration, or live
infrastructure changed. No runtime code beyond presentation text changed.

Independent exact-product review and any actual desktop/mobile browser evidence
belong in the separate status handoff. This maker has not tested a physical phone
or a live terminal connection. Shared session attachment, multi-host registry,
Linux/mobile agents, and a browser re-pair recovery control remain outside scope.
