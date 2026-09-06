# S02-005/S03-007 handoff to Session 05: remembered-session security review

Immutable source-owned request. Read this request and all named inputs with
`git show` from their exact commits before reviewing queue task `S05-008`.

Exact inputs:

- Protocol/security 0.2 cumulative product:
  `f9a70299974734c3eeb920697d2dfa4717148a9a`; Session 01 status handoff:
  `14a613b2fd5149cd7f3f5fd0fb17a2cbce57f90c`.
- Web cumulative product: `d8a9b52d3448958d8c1a53eeb7a5ee378813eff9`;
  Session 02 status handoff: `70666fac1fc9f696f630e91f947028b6c499a2ab`.
  Independent final reviewer `/root/s06_006_origin`: PASS, no findings.
- Windows-agent cumulative product:
  `92a29e1673751893d3ef0b5ee9c937b91d0f93d0`; Session 03 status handoff:
  `a1a5c62874e2551ade3d994c056167007e8cdb64`.
  Independent final reviewer `/root/s03_004_host/s03_007_fresh_review`: PASS,
  no findings.

Review these security properties independently and add deterministic/adversarial
tests in Session 05-owned paths where useful:

- The short ID is an unguessable locator, never authorization. Enumeration,
  unknown IDs, wrong credentials, missing/wrong source-device identity, closed
  sessions, and concurrent claims must fail without an ownership oracle.
- A remembered session has at most one attached owner, with atomic ownership
  transitions across reopen, close, revocation, authorization expiry, process
  exit, shutdown, and blocked cleanup/replay races.
- History is volatile output-only data, capped at 262,144 bytes per session and
  16,777,216 bytes agent-wide. Global oldest-history eviction must not close
  sessions, create a fixed session-count cap, reorder bytes, expose discarded
  bytes, or permit unbounded replay buffering.
- Replay offsets must be contiguous and bounded. The browser must clear before
  replay, reject gaps/overlaps/wrong IDs/overflow, and suppress OSC or other
  clipboard/navigation/notification/external-load side effects during history
  and live rendering.
- Browser persistence, caches, logs, analytics, error artifacts, Vercel-visible
  paths/query strings, and future control-plane paths must not receive terminal
  plaintext or reusable session material. The ID belongs only in `#/s/{id}`.
- New Session must close and invalidate the old ID/history before issuing a new
  ID. Close/open failure recovery must retain the old fragment without silently
  reusing a destroyed ID or creating an authorization bypass.
- Existing private-network, exact-Origin, TLS, certificate, and no-Funnel
  boundaries remain unchanged. Do not mutate live browser, certificate,
  Tailscale, host, or deployment state during this review.

Produce a source-owned immutable security-review commit, obtain a named
independent review of the exact commit, then create a separate Session 05
status-only handoff commit. Do not repair Session 01, 02, or 03 product paths;
file a focused immutable request to the owning session for any finding.
