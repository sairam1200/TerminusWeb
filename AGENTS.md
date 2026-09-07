# Terminus Collaboration Rules

This repository is a contract-first workspace for a private web terminal that loads from Vercel and connects directly to a user-owned Windows PC over Tailscale.

## Required read order

1. Read this file completely.
2. Read `docs/ARCHITECTURE.md`, `docs/SHARED_CONTRACTS.md`, and `docs/DEFINITION_OF_DONE.md`.
3. Read the session brief assigned to you under `agents/`.
4. Read `coordination/ownership.yaml`, `coordination/tasks.yaml`, and every dependency named by your task. For a dependency, read its queue entry, owner status, produced contract/artifact, and recorded commit SHA.
5. Read your session status file before changing anything.

## Non-negotiable product boundaries

- Vercel serves the web/PWA assets. Terminal input and output must not be proxied through or stored by Vercel or the future control plane.
- The Windows terminal service remains private. Keep its origin on loopback and expose it only through an explicitly approved Tailscale-private path.
- Tailscale provides connectivity and network policy; it does not replace application pairing, authentication, authorization, or session expiry.
- Do not enable Tailscale Funnel or expose raw terminal, SSH, RDP, or agent ports to the public internet.
- Platform administration must not create a universal terminal-decryption key or silent customer backdoor.
- Roles and billing plans are separate concepts. An Owner role does not automatically imply Premium terminal entitlement.
- The Vercel Hobby deployment is a personal, non-commercial prototype. Do not add paid subscriptions, advertisements, or public commercial onboarding while it remains on Hobby.
- Never log terminal plaintext, commands, clipboard contents, secrets, private keys, auth tokens, or reusable pairing material.

## Evidence and anti-hallucination rules

- Do not invent APIs, package names, platform capabilities, test results, or live state.
- Before using an external API or dependency, verify it from the installed version, lockfile, type definitions, or primary official documentation. Record the source in the handoff.
- Distinguish facts, assumptions, proposals, and unresolved questions. Put unresolved contract decisions in `coordination/requests/`.
- A feature is not complete because code exists or an agent says it works. Completion requires the deterministic checks in `docs/DEFINITION_OF_DONE.md` and the session brief.
- Report exact commands and outcomes. Never claim a test, build, deployment, browser flow, or network path was verified when it was not run.
- Use mocks only at explicit contract boundaries. Label mock-backed results and do not present them as end-to-end proof.
- When primary sources conflict with repository contracts, stop and file a decision request rather than silently choosing one.

## Parallel work and ownership

- One session owns each writable path. Ownership is defined in `coordination/ownership.yaml`.
- Never edit another session's paths directly, even for a small fix. File a source-owned immutable request under `coordination/requests/` or ask the owning session.
- Shared contract files are owned by Session 01. Other sessions may propose changes but must not make unilateral protocol or security-contract edits.
- Each session uses its own Git branch and preferably its own Git worktree. Do not run multiple writing agents against one working tree.
- Within a session, parallel agents must own disjoint files. Use a maker, an independent test author, and a reviewer instead of multiple agents implementing the same file.
- No agent may merge, push, deploy, change DNS, change Tailscale policy, enable public exposure, create billing products, or mutate a live control plane without the user's explicit authorization.

## Branch and handoff rules

- Branch names: `session/01-architecture`, `session/02-web`, `session/03-windows-agent`, `session/04-control-plane`, `session/05-security-network`, and `session/06-verification-release`.
- Keep commits scoped to one task ID from `coordination/tasks.yaml`. A task handoff uses two commits: first the immutable product/task commit, then a status-only handoff commit that records the product commit SHA and evidence. Integration uses the product commit, not the handoff commit.
- Update only your own `coordination/status/session-XX.md` with current task, files changed, commands run, evidence, assumptions, blockers, independent reviewer identity/evidence, and the product/task commit SHA. Commit that status separately as the branch-head handoff commit.
- Session 01 owns task-queue transitions. It reads another session's committed handoff through the shared Git branch ref, not its own stale worktree copy. Session 01 updates `coordination/tasks.yaml` to `in_progress`, `review`, `done`, `verified`, or newly `ready` only from committed evidence.
- Integration occurs through explicit integration tasks. Session 01 first prepares a manifest of exact verified SHAs. Git merge/cherry-pick into an integration branch requires the user's explicit authorization, and Session 06 then verifies the integrated candidate.
- Never weaken or delete a test merely to make a gate pass without an approved contract change.

## Completion levels

- `done`: the task's Definition of Done passes and a named independent reviewer has examined the task commit. This may be a read-only subagent or another designated session. `done` can satisfy implementation dependencies.
- `verified`: Session 06 independently reproduces the applicable deterministic checks against exact commits. `verified` is required for integration and release claims.
- A producer need not be `verified` before a dependent implementation task begins unless that dependency explicitly requires it. This prevents review deadlocks while retaining an independent release gate.

## Governance files

`AGENTS.md`, `coordination/ownership.yaml`, and the session-ownership model cannot be changed by an implementation session under ordinary task authority. Changes require a dedicated governance task, independent Session 06 review, and explicit user authorization.

## Safe stopping rule

After three failed attempts caused by the same underlying condition, stop that task, preserve evidence, update the session status, and file a focused blocker or contract request. Do not loop indefinitely or broaden scope to force progress.

---

# Project: Terminus Web

This file contains instructions for AI coding agents working on the Terminus Web project.

## 1. Project Environment

### Production hosting

The application is hosted on Vercel:

* Vercel project: `gaddr/terminus-web`
* Vercel dashboard: https://vercel.com/gaddr/terminus-web

The production deployment must be treated as the primary production environment.

### Terminal / backend host

The terminal service is reachable through Tailscale using:

```text
wss://sai.tailf8dcea.ts.net/terminal
```

Use this endpoint for WebSocket terminal connectivity when the application is running in the production environment.

Do not replace the Tailscale hostname with localhost unless explicitly working on local development.

## 2. Secrets and Environment Variables

### IMPORTANT

`.env.production` contains production secrets and credentials.

**Never:**

* Print secret values in logs.
* Commit `.env.production` to Git.
* Copy secrets into source code.
* Put secrets into client-side JavaScript.
* Include secrets in API responses.
* Paste secret values into documentation.
* Hard-code API keys, tokens, passwords, cookies, private keys, or credentials.
* Expose server-only environment variables through `NEXT_PUBLIC_*` variables.

When an environment variable is required, read it from the environment.

Example:

```ts
const apiKey = process.env.API_KEY;
```

Do not do:

```ts
const apiKey = "actual-secret-value";
```

### Environment precedence

Use:

1. Existing project environment configuration.
2. `.env.production` for production-specific local/server configuration.
3. Vercel Environment Variables for deployed production configuration.

Do not create duplicate secret configuration unless necessary.

If a required environment variable is missing, identify the variable name but **never request or print its secret value in source code or logs**.

## 3. Production WebSocket

The production terminal WebSocket endpoint is:

```text
wss://sai.tailf8dcea.ts.net/terminal
```

The agent should:

* Use `wss://`, not `ws://`, in production.
* Keep the endpoint configurable rather than scattering the URL throughout the codebase.
* Prefer an environment variable for configuration if the existing architecture supports it.
* Never expose unrelated secrets alongside the WebSocket configuration.
* Handle connection failures gracefully.
* Handle WebSocket reconnects without creating uncontrolled reconnect loops.
* Properly close WebSocket connections when components/services are destroyed.

Recommended configuration pattern:

```ts
const TERMINAL_WS_URL =
  process.env.TERMINAL_WS_URL ??
  "wss://sai.tailf8dcea.ts.net/terminal";
```

If the application already has an established configuration system, follow that system instead of introducing a second one.

## 4. Client vs Server Secrets

Before changing environment variables, determine whether the code executes:

* On the server
* In a Vercel serverless function
* In the browser
* During build time
* In middleware/edge runtime

Never send server-only secrets to the browser.

Variables required by browser code must be explicitly designed as public configuration.

Do not blindly rename a secret to `NEXT_PUBLIC_*`.

## 5. Vercel Deployment

The project is deployed through Vercel.

When making deployment-related changes:

1. Inspect the existing Vercel configuration.
2. Inspect `package.json`.
3. Inspect the framework configuration.
4. Inspect existing environment-variable usage.
5. Inspect the existing build command.
6. Avoid changing deployment configuration unless required.
7. Do not assume that local development behavior exactly matches Vercel production behavior.

Before declaring a deployment change complete:

* Run the relevant tests.
* Run the production build when practical.
* Check for TypeScript errors.
* Check for lint errors.
* Verify environment-variable references.
* Verify the production WebSocket configuration.

## 6. Tailscale Dependency

The terminal endpoint depends on Tailscale networking.

Do not attempt to "fix" a Tailscale connectivity problem by:

* Removing `wss://`.
* Replacing the hostname with a random public hostname.
* Disabling TLS verification.
* Adding insecure WebSocket fallbacks.
* Exposing the terminal server publicly without explicit authorization.

If the Tailscale endpoint cannot be reached, diagnose the connection and configuration first.

## 7. Terminal WebSocket Behavior

Terminal connections should be treated as long-lived connections.

The implementation should correctly handle:

### Connection

* Connecting
* Connected state
* Authentication/handshake if required
* Connection timeout
* Connection failure

### Runtime

* Incoming terminal output
* User terminal input
* Resize events
* Binary messages if supported
* Text messages
* Server errors

### Disconnection

Handle:

* Normal close
* Unexpected close
* Network interruption
* Server restart
* Tailscale connectivity failure

If automatic reconnect exists:

* Use bounded retries.
* Use exponential backoff.
* Avoid reconnect storms.
* Reset the retry counter after a successful connection.

## 8. Security Requirements

The terminal connection is security-sensitive.

Never:

* Log terminal credentials.
* Log authentication tokens.
* Log environment-variable values.
* Log shell commands if they may contain secrets.
* Store terminal secrets in browser local storage unless explicitly required and reviewed.
* Disable TLS validation.
* Allow arbitrary WebSocket destinations supplied by an untrusted user.
* Introduce SSRF through configurable terminal endpoints.
* Expose `.env.production` through static files or API routes.

Validate any user-controlled terminal/session identifiers before using them in backend requests.

## 9. Repository Investigation Rules

Before modifying existing functionality:

1. Search the repository for the relevant feature.
2. Find the existing configuration/constants.
3. Understand the current data flow.
4. Check server/client boundaries.
5. Check existing tests.
6. Make the smallest appropriate change.

Do not create a new abstraction when an existing project abstraction already handles the same responsibility.

Prefer consistency with the current codebase over introducing a preferred framework/library/pattern.

## 10. Environment Variable Discovery

When investigating configuration, search for:

```text
process.env.
import.meta.env.
NEXT_PUBLIC_
TERMINAL_
WS_
WEBSOCKET_
TAILSCALE_
```

Also inspect:

```text
.env
.env.local
.env.production
.env.example
vercel.json
package.json
```

Do not expose the values contained in these files.

When documenting configuration, document only variable names and safe descriptions.

Example:

```text
TERMINAL_WS_URL=<production WebSocket endpoint>
```

Never document:

```text
API_KEY=actual-production-secret
```

## 11. Local Development

Local development may use a different terminal endpoint.

Do not force production Tailscale infrastructure into every local-development workflow unless the application requires it.

If a local terminal server exists, prefer the existing local configuration.

If no local endpoint exists, use the production endpoint only when explicitly intended and when the developer has the necessary network access.

## 12. Error Handling

Errors should be useful without leaking sensitive information.

Good:

```text
Terminal connection failed.
```

Better:

```text
Terminal connection failed: WebSocket closed unexpectedly.
```

Avoid:

```text
Terminal connection failed with token abc123...
```

Never include:

* API keys
* Access tokens
* Cookies
* Passwords
* Private keys
* Full environment-variable dumps

in errors or logs.

## 13. Testing

For changes involving the terminal connection, test at minimum:

### Build

```bash
npm run build
```

or the project's existing production build command.

### Tests

Run the project's existing test command.

### Type checking

Run the project's existing TypeScript/type-check command if available.

### WebSocket

Verify:

1. The application attempts to connect to the expected endpoint.
2. Connection success is handled.
3. Connection failure is handled.
4. Disconnect is handled.
5. Reconnect behavior does not loop uncontrollably.
6. Terminal input reaches the backend.
7. Terminal output reaches the UI.
8. Browser cleanup closes the connection.

Do not claim a production connection works unless it has actually been tested.

## 14. Git Rules

Before committing:

```bash
git status
git diff
```

Check carefully for:

* `.env.production`
* `.env.local`
* credentials
* generated secrets
* debugging logs
* temporary files

Never commit production secrets.

If `.env.production` is not already ignored, add the appropriate environment-file protection to `.gitignore` before committing, while preserving any intentionally tracked example configuration.

Recommended:

```gitignore
.env
.env.local
.env.production
.env.*.local
```

If the repository intentionally tracks a non-secret environment template, use:

```text
.env.example
```

with placeholder values only.

## 15. Change Discipline

For every task:

1. Understand the requested change.
2. Inspect the existing implementation.
3. Identify the smallest safe change.
4. Implement it.
5. Run relevant tests/checks.
6. Review the diff.
7. Verify that no secrets were introduced.
8. Report exactly what changed.

Do not make unrelated refactors.

Do not change production infrastructure merely because a different architecture seems preferable.

## 16. Production Configuration Summary

Safe configuration information:

| Item                         | Value                                            |
| ---------------------------- | ------------------------------------------------ |
| Hosting                      | Vercel                                           |
| Vercel Project               | `gaddr/terminus-web`                              |
| Production terminal protocol | WebSocket Secure (`wss`)                          |
| Terminal endpoint            | `wss://sai.tailf8dcea.ts.net/terminal`              |
| Production secrets           | `.env.production` / Vercel Environment Variables  |
| Secret handling              | Server-side only unless explicitly public        |

## 17. Agent Completion Checklist

Before saying a task is complete:

* [ ] Existing architecture inspected
* [ ] No production secrets exposed
* [ ] `.env.production` not committed
* [ ] Client/server environment boundaries respected
* [ ] Production WebSocket endpoint preserved
* [ ] `wss://` used for production
* [ ] Error handling does not leak secrets
* [ ] Relevant tests run
* [ ] Production build checked when appropriate
* [ ] Git diff reviewed
* [ ] No unrelated changes introduced
* [ ] Final response clearly describes the changes and any remaining limitations

## 18. Important Principle

**Do not guess infrastructure configuration.**

If the repository, environment, or deployment configuration contains an established value or implementation, inspect and use it.

If something is unknown, investigate it before changing production behavior.

When a secret is required, use the environment variable name—not the secret value.

When a production endpoint is required, use the configured production endpoint:

```text
wss://sai.tailf8dcea.ts.net/terminal
```
