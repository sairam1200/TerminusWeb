# Intelligence 1.0 implementation clarifications

## Credential-device migration

Approved by Session 01 on 2026-09-07 after source inspection found existing protected Credential records have no device field. New pairings save DeviceIdentity. Existing unbound records may be pinned once following successful terminal HMAC authentication on an already verified private device. Pinning must be atomic and may not overwrite a different existing binding. Intelligence requires an established matching binding and otherwise fails closed. The terminal 0.2 wire and ordinary behavior remain compatible. Tests must cover concurrent first-use pinning and wrong-device intelligence rejection.

## Identity retention

Private history ownership is distinct from an expiring connection/session. Guest-to-user linking and logout atomically rotate credential/device application sessions. Logout cannot make prior account records visible to the fresh guest or a later different account. Ledger/quota ownership survives session expiry. Session 04 owns the exact normalized migration and Session 03 consumes that schema without maintaining a second migration history.

## Local Chrome staging

The integration host may optionally serve web assets through an explicitly configured loopback-only `http://127.0.0.1:<port>` upstream. Only the fallback web route uses the reverse proxy; `/terminal` and `/intelligence` remain direct handlers on the same original browser mTLS connection. No command traffic goes through Next or Vercel. Default hosting remains Vercel. This allows local staging at the already trusted private HTTPS hostname without generating/installing a certificate, weakening TLS or changing Tailscale Serve. The staging web and agent must configure that exact HTTPS Origin. Reject non-loopback upstreams, userinfo, non-root paths, queries and fragments. Report such browser evidence as local staging, never production deployment.

## RPC boundaries

History limit is 1 through 100 inclusive (default 50). `personalization:true` without history consent is invalid. Account passwords are 12 through 1024 UTF-8 bytes, name 1 through 120 characters, email at most 320 characters. Passwords are transient authentication input only; use a maintained password KDF with random salt, bounded work and generic login failures. The canonical RPC fixture corpus includes malformed ownership injection, multiline input and consent cases; both consumers must test it or record the exact missing parity gate.

## Quota principal survives identity rotation

Independent review found that creating a new guest history owner on logout or guest deletion could otherwise reset monthly AI allowance. The private prototype therefore binds the 100000-token monthly model budget to a durable paired credential/device principal, separate from the current guest/account history owner. Keep the mapping and immutable usage accounting when guest/history data is deleted or sessions rotate. Resolve this principal only on the server. Reserve/finalize model calls and report AI usage against it; label the UI as paired-device AI usage/allowance. Account login does not replenish the allowance. History, command counts and personalization remain current-owner scoped. Add a regression proving identity rotation and guest deletion do not reset consumption or outstanding reservations. Administration may see aggregate counts, never other owners' command contents.

## Authorization evidence

## Complete bounded exports

Independent review found a single export could exceed the 64KiB frame cap. `data.export` therefore takes optional `cursor` UUID and always returns `nextCursor` UUID or null alongside session/history/usage. Return at most 50 records and at most 60KiB serialized result, preserving the 64KiB transport cap. Records order by created_at DESC, event_id DESC. Resolve the cursor record only within the active history owner; use its timestamp/ID tuple for the next page. Missing, deleted or foreign cursor returns NOT_FOUND. Non-null nextCursor means more records remain; never silently truncate an export. Newer records arriving after the initial page stay above the cursor and do not enter later pages. The browser collects pages until null, verifies unchanged application session/client throughout, and discards the in-progress export if identity changes. Deletion during export may require an explicit retry; do not invent snapshot isolation across multiple requests.

## Authorization evidence (continued)

User: "yes confirmed next time dont ask permission do the best", responding to the explicit proposed opt-in, redacted private-host command-history exception. Routine code, test, isolated worktree/database setup and Chrome verification are authorized. No extra approval prompts for these steps. Actual live secrets, TLS/device authentication and private-only networking remain protected.
