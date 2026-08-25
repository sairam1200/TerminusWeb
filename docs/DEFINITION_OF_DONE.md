# Definition of Done

A task is complete only when all applicable evidence exists.

## Every task

- The implementation matches an approved task and owned path.
- Formatting, linting, type checking, unit tests, and relevant integration tests pass.
- New behavior has positive, negative, boundary, and failure-path tests.
- No secrets or terminal plaintext are present in source, fixtures, logs, screenshots, or test artifacts.
- Dependency names and APIs were verified against installed versions or official primary documentation.
- The owning session status records commands, results, remaining limitations, and commit SHA if committed.
- No unrelated files changed.

## Contract-sensitive changes

- Protocol/security version is explicit.
- Both consumers pass the same contract fixtures.
- Malformed, oversized, unauthenticated, unauthorized, expired, and replayed inputs are rejected.
- Session 01 confirms compatibility and Session 06 independently verifies it.

## Web changes

- Desktop and iPhone-sized browser tests pass.
- Keyboard, resize, reconnect, focus, paste, and accessibility behavior are covered where applicable.
- Content Security Policy and exact WebSocket origin policy are verified.
- A preview URL alone is not proof of the terminal path.

## Windows-agent changes

- Tested on an explicitly recorded Windows version.
- The shell is non-elevated by default.
- ConPTY resources and child processes are cleaned up on close, timeout, and agent failure.
- Listener scope is verified; no unintended public or LAN listener exists.
- Logs are checked for terminal plaintext and secrets.

## Network/security changes

- Local origin, Tailscale device identity, approval, key expiry, listener, and policy are distinguished.
- At least one intended allowed flow and one intended denied flow are tested.
- `tailscale ping` is not treated as proof that the application endpoint works.
- Serve remains private. Funnel and public SSH remain disabled; enabling either requires both explicit user authorization and an approved architecture/contract change, and remains outside the current product baseline.

## Release changes

- Exact immutable commit is recorded.
- Build artifacts are reproducible and checksummed where appropriate.
- Rollback procedure is documented and tested in staging.
- Deployment requires separate explicit user authorization.
