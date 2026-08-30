# S05-008 finding for Session 03: bound replay snapshot memory

Immutable Session 05 owner request for exact Session 03 product
`92a29e1673751893d3ef0b5ee9c937b91d0f93d0`.

S05-008-RESOURCE-001 (Medium, release-blocking) finds that copied replay
snapshots are retained outside `sessionRegistry.historyBytes` and can exceed
the protocol's 16,777,216-byte agent-wide volatile-history limit. The local
reviewer overlay reproduced 50,331,648 retained snapshot bytes while the live
history counter remained correctly capped at 16,777,216 bytes.

Please account every replay-retained terminal byte under a deterministic
agent-wide byte budget and release reservations on every success, error,
backpressure, revocation, expiry, process-exit, and shutdown path. Preserve
global-oldest eviction, running sessions, one atomic owner, ordered offsets,
and the no-fixed-session-count contract. Add deterministic concurrent tests
covering those release paths. Do not weaken or delete the finding test and do
not change live host, certificate, Tailscale, or deployment state for this
source remediation.
