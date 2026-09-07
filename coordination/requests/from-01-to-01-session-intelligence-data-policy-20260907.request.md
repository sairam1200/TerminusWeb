# Session intelligence: persistence decision and execution plan

Status: proposed; user data-policy answer pending. This is not an approved protocol or implementation handoff.

## Request and evidence

The user requested execution of `C:\Users\saira\Downloads\terminus-session-intelligence-end-to-end.md`, use of the RAG setup, and verification in Chrome. The user authorized the work generally. The brief also says the repository remains authoritative and existing architecture must not be replaced merely to implement the feature.

Inspected application baseline: main at `f3e5bd6063c13ea79e5d585dab3f45f7658e15fb`. This request is isolated on `session/01-architecture` at `17f028d196372992c1871433a1c73db406b5cd0a`; that branch predates main's recovery. No histories were merged or rewritten.

The brief asks for persisted submitted commands and parameters, user association, recommendations, analytics, token accounting, billing foundation, privacy controls, and dashboards. Existing architecture permits only bounded volatile terminal output history and prohibits persisting terminal plaintext. The control plane is explicitly metadata-only. The user has been asked to choose private-host opt-in redacted command persistence or preservation of the no-persistence policy with catalog-only recommendations. No answer has been received at the time of this request.

## Proposed exception for approval

Keep Vercel responsible for the web assets. Keep terminal traffic direct to `wss://sai.tailf8dcea.ts.net/terminal`. Never relay command contents through Vercel or the metadata control plane.

Permit only explicitly submitted, consented, sanitized command records on the private host. Default collection and personalization off. Do not persist raw xterm input/output, reconstruct commands from terminal bytes, or infer successful execution from connection state. Reject uncertain sensitive content or retain only approved catalog identifiers. Redaction cannot prove that arbitrary free text is secret-free.

Use a separate versioned intelligence capability authenticated and authorized against the existing credential/device identity. Preserve protocol 0.2 behavior for clients that do not negotiate the new capability. Exact frames, payload bounds, rate limits, retention, consent transitions and error semantics require canonical fixtures before consumers implement them.

Do not add cookies to the current terminal origin without reviewing compatibility: `/terminal` currently rejects Cookie and Authorization headers. Client certificates alone do not authorize private command-history access. Private HTTPS APIs would additionally require a reviewed CSP and authentication design.

## Smallest observable flow

1. A guest opens the terminal; account identity remains distinct from paired terminal identity.
2. The user explicitly enables private command history and uses a labelled command composer.
3. Submission goes directly to the private host. An unavailable intelligence service does not prevent ordinary terminal use.
4. A sanitized, owner-scoped record is stored transactionally in PostgreSQL with expiry and idempotency.
5. A curated command catalog supplies recommendations, purpose, risk and source references.
6. Selecting a recommendation populates the composer and never silently executes it.
7. The user can inspect, export and delete their eligible records, and disable further collection.
8. Completion status remains unavailable until a real shell integration supplies trusted completion events. Terminal bytes are not parsed as completion evidence.

## Remaining architecture work

- Define account authentication and guest-to-user association using proof of both identities. Browser-supplied user IDs are never authoritative; rotate session credentials after association.
- Extend the existing metadata schema rather than replacing `terminus_cp`. Keep private command storage and account/admin analytics access separate.
- Enforce cross-user isolation in every query and transaction. Bind recommendations and connection records to their server-resolved owner.
- Define bounded retention and deletion for commands, events, IP metadata, guest identities and retrieval indexes. Export and deletion must respect ownership and erase derived personal retrieval entries.
- Use trusted proxy configuration for server-observed IPs; otherwise retain the socket peer or omit the value. Do not trust arbitrary forwarded headers.
- Keep token usage in an idempotent append-only ledger populated by actual provider responses. Do not invent usage or costs when no model is configured.
- Reserve quotas transactionally before billable calls and reconcile failures. Terminal access must retain its separate entitlement policy.
- Reuse passive billing entities. Keep checkout and commercial activation disabled while hosting remains Hobby. No paid product or public commercial onboarding is required to prove this feature.
- Limit admin dashboards to authorized metadata; admin roles do not grant private command-history access.

## RAG

The existing local developer retrieval setup is present in `scripts/rag` and uses `rag/app_rag.db`. The contract-first query below ran successfully and retrieved architecture and security boundaries. Retrieved references were checked against the current source; the existing index is not immutable commit evidence.

Product RAG remains distinct from this developer tool. Proposed product retrieval uses an approved, source-attributed command/documentation corpus. User history, if approved, stays owner-filtered on the private host. Neither repository secrets nor terminal output belong in the corpus. Retrieved text is untrusted context and cannot override the command catalog or execution policy. Lexical retrieval and deterministic explanations must not be described as verified model-generated RAG. A generation provider and its data boundary must be configured and tested before claiming that stage works.

## Owner sequence

1. Session 01: record the user's data-policy decision; version contracts and fixtures; add scoped queue tasks.
2. Session 04: metadata/session persistence, migrations, authorization, accounting and passive billing foundation, within existing owned paths.
3. Session 03: private host capability, consented explicit submissions, private persistence integration and lifecycle events.
4. Session 02: composer, recommendations, history, usage, account/privacy and disabled billing UI using the frozen contracts.
5. Session 05: independent isolation, redaction, consent, retention, retrieval and private-network review.
6. Session 06: exact-commit database/API/protocol verification and real Chrome desktop/mobile flows, then authorized candidate/deployment verification.

Each writer needs an exclusive owner worktree. Current owner branch histories differ from recovered main, so prepare an exact reviewed baseline before implementation dispatch. No speculative writer was launched.

## Checks actually performed

- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/rag/ask-contracts.ps1 'command history persistence terminal plaintext control plane authentication analytics' -K 30 -Top 4`: exit 0; returned four relevant contract references. This used local retrieval; it did not configure product RAG.
- `npm test` in `apps/web` at the main baseline: sandbox initially failed with `spawn EPERM`; approved execution outside the sandbox passed 9 files / 76 tests, exit 0.
- `npm test` in `services/control-plane` at the main baseline: sandbox initially failed with `spawn EPERM`; approved execution outside the sandbox passed 37 tests, exit 0.
- `docker info --format '{{.ServerVersion}}'`: could not connect to Docker Desktop's Linux engine. Database migrations were not run.
- Existing environment-file discovery showed no `.env*` files in the repository root or `apps/web`. No secret values were printed. Database/auth/model runtime configuration is not established by this preflight.
- Chrome opened `https://terminus-web.vercel.app/`; current UI loaded with private mode selected, protocol 0.2 and a disconnected terminal. This proves page load only. No terminal connection, submitted command, new feature or post-deployment flow was verified.
- Independent read-only preflight by `/root/intelligence_preflight` confirmed stream-capture ambiguity, persistence-contract conflict, missing account auth and cookie/mTLS/CSP compatibility constraints. This is design preflight, not product review or Session 06 verification.

No implementation, protocol, deployment, billing, certificate, Tailscale or production data changes were made. The previously requested main `AGENTS.md` edit and four unrelated untracked test scripts were preserved.
