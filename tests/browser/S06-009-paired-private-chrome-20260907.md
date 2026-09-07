# S06-009 paired private Chrome read verification

Independent verifier: `/root/intelligence_verification`, Session 06, 2026-09-07.
Result: **PASS for authenticated private guest/privacy/usage reads in actual
Chrome**. This supersedes the earlier browser-access block only for this scope.
It is not a complete product-flow, integrated-candidate or deployment result.

## Inputs and boundaries

The coordinator reported that the user completed normal operator-console pairing
and the existing private host remained running. Current web product is
`88108ff96d3294ea5230a467595a68d783ea1840`, with owner status `1fb5557`.
Runtime implementation remains Go `a6adf52afeeb87ad9e6907c79baa9c9023c562a4`
and PostgreSQL schema `33cc6383ff6af9a049113206a6a57d8690936de2`.
The coordinator's rebuilt executable SHA-256 was supplied as
`4B9CD09CF60ECD18108205C067722197442304A758C74B22BECBE047F097EC4D`;
this browser-only verifier did not independently hash or launch it.

Read the current authoritative queue, existing Session 06 status, web producer
status and exact `88108ff` source delta. Independent read-only delta inspection
confirmed that transport failure diagnosis remains browser-local, genuine server
session-open errors retain their guidance, pre-upgrade close settles connection,
stale/error-state socket events are fenced, and configured-origin links use
validated profiles without copying the current fragment. No new finding arose.
The owner's 123 tests and root's 10 focused tests are recorded in its handoff;
this verifier did not repeat those already-passing suites in this bounded check.

## Actual browser operations and observations

Used the documented `mcp__cua_repl` API and the Computer Use skill. The coordinator
transferred the browser-operation lock for this check and received it back after
cleanup. Initial selection of the coordinator's safe account tab reported ownership
by another automation session. Selection through the current browser's tab list
also found no owned tabs; its user-tab listing did not expose either authorized
existing tab. These were automation-session ownership limits, not TLS or pairing
failures. No terminal accessibility tree or screenshot was requested.

The verifier instead opened one fresh private privacy tab in the same Chrome
browser/profile, leaving the connected terminal and existing account tab intact:

```javascript
let independentPrivacy = await cua.createBrowserTab(
  "1", "https://sai.tailf8dcea.ts.net/account/privacy",
  { sessionName: "🔎 Private UI verification" }
);
// Fresh accessibility state exposed Usage as element 5.
await independentPrivacy.click(5);
await independentPrivacy.getAXState();
await independentPrivacy.close();
```

The new tab was `2085818383`; only that tab was closed after inspection.

Privacy loaded directly over the actual private HTTPS hostname and displayed:

- Guest session; retention up to 30 days.
- Save redacted composer history unchecked.
- Optional usage analytics unchecked.
- Personalization unchecked and disabled while history consent is off.
- Export and deletion controls available, with none activated.

Clicking its actual Usage navigation link loaded the private `/usage` page:

| Visible metric | Actual observed value |
| --- | --- |
| Sessions | 1 |
| Recorded commands | 0 |
| Connected minutes | 0 |
| Recommendation impressions / clicks | 0 / 0 |
| Paired-device AI requests | 0 |
| Input / output / total tokens | 0 / 0 / 0 |
| Remaining tokens | 100000 |
| Top sanitized commands | No recorded command activity |

These populated views independently establish that Chrome reused the ordinary
paired browser credential to authenticate the private intelligence path and
retrieve guest/privacy/usage data from the running service/database. No credential
was entered, injected, exported or logged; no certificate warning was bypassed.
There was no model call, command submission, privacy toggle, account input,
export/deletion, terminal inspection or terminal disconnect. All optional
collection remained off. No other browser tabs, including consent tabs, were read.

## Scope still unverified

The coordinator separately observed the original terminal's public status badge
as Connected and six actual catalog recommendation cards. Those are coordinator
observations, not independently read by this verifier because its browser session
could not bind the existing terminal tab. Terminal input/output was deliberately
excluded from this read-only check.

Live composer recording, consent changes, account registration/login/logout,
complete export/deletion, reconnect/lifecycle and mobile paired behavior were not
exercised here. Earlier deterministic tests cover those boundaries but do not make
them real-browser results. Actual Ollama generation, physical iPhone/Safari,
production Vercel deployment and an exact assembled release remain unverified.
The successful private paired read gate must not be reported as full end-to-end
completion of all intelligence workflows.
