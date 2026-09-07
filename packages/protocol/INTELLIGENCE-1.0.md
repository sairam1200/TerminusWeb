# Private session intelligence 1.0

Approved implementation baseline, S01-008, 2026-09-07. The user explicitly confirmed opt-in redacted private-host command persistence and instructed autonomous execution. This capability does not change terminal protocol 0.2.

## Transport and authentication

- A second WebSocket uses `/intelligence` on the exact configured terminal host and `terminus.intelligence.v1`. Derive that path from the validated terminal URL; never accept arbitrary destinations. Existing `/terminal` keeps `terminus.v0_2` unchanged.
- Same loopback TLS listener, verified private client certificate/device and exact HTTPS Origin requirements as terminal; no Cookie, Authorization, URL query or fragment. No HTTP terminal proxy, CORS relaxation, LAN bind, Funnel or new public listener.
- Server sends `{type:"challenge",connectionId,challengeId,challenge,expiresAt}`. IDs are random UUIDv4, challenge is canonical unpadded base64url of 32 random bytes. Expiry is UTC RFC3339 with milliseconds, 10 seconds. Client sends `{type:"authenticate",credentialId,proof}` within that deadline.
- Proof is HMAC-SHA256 using the existing paired credential: UTF-8 `Terminus/intelligence/1/auth`, NUL, UTF-8 connectionId, NUL, UTF-8 challengeId, NUL, decoded challenge bytes. Canonical unpadded base64url result. New domain prevents reuse of terminal authentication proofs.
- Resolve credential from the protected existing store, require unexpired and same server-resolved private device association. Challenge single-use per socket. No pairing on this path. Recheck credential validity/revocation per request. Auth lifetime at most 12 hours or credential expiry, whichever is earlier. Limits: handshake failures bounded per device, max 64 KiB UTF-8 text messages, max 5 active requests per connection, max 120 requests/minute, safe errors only. Binary messages and unknown envelope fields fail closed. Close on expired authorization.
- On success: `{type:"ready"}`. On transport/auth failure close without sensitive detail. WebSocket ping/pong every 15 seconds and 45-second liveness deadline. Client connection retries at most 3 using 1/2/4 seconds, cancelled on disposal; manual retry allowed. Recommendations failure must not close the terminal socket.

## RPC

Request: `{type:"request",id,method,params}` where id is UUIDv4, params a closed method-specific JSON object. Response: `{type:"result",id,ok:true,data}` or `{type:"result",id,ok:false,error}`. Error is one of `INVALID_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `UNAVAILABLE`, `RATE_LIMITED`, `CONSENT_REQUIRED`, `CONFLICT`, `QUOTA_EXCEEDED`. Never return database, model, credential or command-bearing errors. Client request timeout 10 seconds. Model request may use 8 seconds within that bound.

Methods and exact params:

| Method | Params | Result data |
| --- | --- | --- |
| `session.current` | `{}` | SessionSnapshot |
| `privacy.update` | `{history:boolean,analytics:boolean,personalization:boolean}` | SessionSnapshot |
| `command.record` | `{eventId:UUID,command:string}` | `{recorded:boolean,event:CommandEvent|null}` |
| `history.list` | `{query?:string,category?:string,limit?:integer}` | `{items:CommandEvent[]}` |
| `history.delete` | `{}` | `{deleted:true}` |
| `analytics.delete` | `{}` | `{deleted:true}` |
| `guest.delete` | `{}` | SessionSnapshot |
| `data.export` | `{cursor?:UUID}` | `{session:SessionSnapshot,history:CommandEvent[],usage:Usage,nextCursor:UUID|null}` |
| `recommendations.get` | `{query?:string}` | `{items:Recommendation[],mode:"catalog"|"local-model"}` |
| `recommendation.click` | `{id:string}` | `{recorded:boolean}` |
| `terminal.record` | `{eventId:UUID,state:"connected"|"disconnected"|"reconnecting"}` | `{recorded:boolean}` |
| `usage.get` | `{}` | Usage |
| `account.register` | `{email:string,password:string,name:string}` | SessionSnapshot |
| `account.login` | `{email:string,password:string}` | SessionSnapshot |
| `account.logout` | `{}` | SessionSnapshot |
| `billing.get` | `{}` | `{plan:"Personal prototype",commercialEnabled:false,tokenLimit:integer,tokensUsed:integer}` |
| `admin.overview` | `{}` | `{users:integer,sessions:integer,commands:integer,inputTokens:integer,outputTokens:integer,totalTokens:integer,activeConnections:integer}` |

Snapshot: `{sessionId:string,identity:"guest"|"authenticated",user:{id:string,email:string,name:string}|null,privacy:{history:boolean,analytics:boolean,personalization:boolean},retentionDays:integer,admin:boolean}`. UUID session belongs to server-resolved credential/device; never use browser user IDs for ownership. Every session.current refresh updates activity subject to expiry. Authentication rotates application session ID and associates only the caller's eligible guest history. Logout clears active account association across sockets for that credential and returns a fresh guest session; it must not expose the prior account's history. Private local account registration is available only after terminal pairing, with password hashing and bounded login attempts; email is an account identifier, not a verified email claim. No public onboarding or email sending.

CommandEvent: `{id:string,command:string,category:string,purpose:string,createdAt:string,status:"submitted",exitCode:null,durationMs:null}`. `command` is sanitized display text, never original arbitrary args. Composer input bounded to 4096 UTF-8 bytes; reject control characters/newlines and strip all arguments to a reviewed command template before persistence. Unknown or uncertain commands become `[redacted command]`. No terminal output or keyboard stream capture. Status cannot be inferred from socket or composer success. Outcome filters are unavailable until trusted shell completion exists.

Recommendation: `{id:string,command:string,category:string,purpose:string,reason:string,risk:"read"|"write",sourceUrl:string}`. IDs are catalog IDs, authoritative at server. Commands come only from reviewed templates. At most 6 results. `query` at most 256 characters, remains ephemeral; never send private query/history to a hosted model. Selecting recommendation fills an explicit composer, never sends Enter. Exclude destructive/high-risk commands; show risk and unresolved placeholders. Track impressions/clicks only with analytics consent; no execution claim from a click.

Usage: `{sessions:integer,commands:integer,terminalTimeMs:integer,recommendationImpressions:integer,recommendationClicks:integer,inputTokens:integer,outputTokens:integer,totalTokens:integer,aiRequests:integer,tokenLimit:integer,remainingTokens:integer,topCommands:{command:string,count:integer}[]}`. Terminal durations are explicitly client-observed connection durations, bounded by session liveness; never shell execution durations. Unknown success/failure remains unknown. `commands` counts opted-in sanitized submissions, not all terminal activity.

## Storage and RAG boundaries

Private PostgreSQL uses schema `terminus_intelligence`; migration owned by Session 04 at infrastructure/database. Go consumer's SQL and exact table schema are coordinated directly before implementation. No replacement of existing metadata-only `terminus_cp`. A least-privileged role and server-enforced owner predicates are required. Database config is `TERMINUS_INTELLIGENCE_DATABASE_URL` on the agent only. Failure/unset means intelligence unavailable while terminal remains operational. Migrations run explicitly against the configured private database, never automatically on production startup.

Defaults: history/analytics/personalization false; 30-day command/event/session maximum, 7-day inactive guest retention. Queries exclude expired records immediately; bounded maintenance purges expired rows. Turning history off stops collection; deletion removes associated recommendation personalization. Personalization requires history consent. A minimal identity/session row exists for app security independent of optional analytics. No raw IP/location storage initially; no forwarding-header trust or MAC collection. Admin allowlist is server-only `TERMINUS_INTELLIGENCE_ADMIN_CREDENTIAL_IDS`; admin receives aggregate metadata, no other user's commands.

RAG retrieves a curated source-attributed command corpus locally and personalizes only with the current owner’s consented sanitized history. Deterministic catalog explanations work with no model. Optional local Ollama endpoint `TERMINUS_INTELLIGENCE_OLLAMA_URL` must be explicit loopback HTTP without credentials/query; model name `TERMINUS_INTELLIGENCE_MODEL`. No default external generation. Context consists only of catalog documents and templates; generated text is explanation only, commands and URLs remain catalog-authoritative. Bound output and treat retrieved/model text as untrusted. Report `catalog` when generation is absent/fails; never label it a verified model call.

Token ledger entries are append-only and unique by provider request ID. Use actual provider counts and transactional quota reservations before generation; reconcile failures. No synthetic token/cost estimates presented as measured usage. Initial monthly token limit 100000; reserved budget must fence concurrent calls. Passive plan/subscription/payment/webhook metadata extends existing conventions, commercial operations disabled on Hobby.

## Required evidence

Both consumers share auth vectors and RPC fixtures. Verify wrong proof/device/origin, stale/replayed challenge, oversized/unknown fields, expiry/revocation, cross-owner reads/linking/deletion, consent-off non-persistence, redaction, idempotent events, logout isolation, retention, ledger/quota concurrency, unavailable DB/model and cleanup. Database tests run on actual PostgreSQL. Chrome proof must identify local/staging/production and distinguish real sockets/database from doubles. Build/type/lint/tests and independent review precede integration/release claims.
