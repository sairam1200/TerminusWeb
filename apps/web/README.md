# Local and Private terminal modes

The header shows Local / Private beside the language control.

- Local connects to the Windows agent on the same computer through a configured loopback WSS endpoint. It requires a locally hosted Terminus page under the existing local-origin policy.
- Private connects directly to the configured agent through its private Tailscale WSS endpoint.
- If a mode uses a different configured page origin, its control opens that page without transferring a session fragment or credentials. Both installations must have their own matching configuration.
- Missing profiles are disabled. With no configured profiles, the existing labelled simulation remains a simulation.
- Detach or cancel before switching modes. Same-page switches preserve the language selection and discard the previous endpoint's session fragment.

Configure both endpoint/origin pairs at build time to make both modes available:

| Mode    | Endpoint                                  | Exact page origin                       |
| ------- | ----------------------------------------- | --------------------------------------- |
| Local   | `NEXT_PUBLIC_TERMINUS_LOCAL_WSS_ENDPOINT` | `NEXT_PUBLIC_TERMINUS_LOCAL_WEB_ORIGIN` |
| Private | `NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT`       | `NEXT_PUBLIC_TERMINUS_WEB_ORIGIN`       |

Set `NEXT_PUBLIC_TERMINUS_CONNECT_MODE` to `local` or `private` for the initial preference. A saved compatible choice takes precedence. The local endpoint and page origin must use loopback hosts. Private requires an HTTPS page origin and a non-loopback WSS endpoint. The agent must trust the exact page origin, and the browser must trust its server certificate and supply the required client certificate. Pairing and authentication still apply.

A website cannot start the computer's native terminal by itself. This control selects an installed, configured agent; it does not install or start one. No terminal transport is relayed through Vercel.

## Authorize another device for the same host

Each browser can independently access the same configured host, including a browser running on the host itself. For private access, every device needs Tailscale connectivity, trust in the host's TLS certificate, and the required client certificate. Network access and certificates do not replace application authorization.

Generate a fresh short-lived, single-use pairing code on the host for each additional browser. Enter it in that browser and approve its request on the host. Codes expire after two minutes and are consumed on the first syntactically valid attempt, including unsuccessful attempts. Never reuse another browser's code or copy its credential.

After approval, the browser stores its own non-extractable signing key in IndexedDB. New terminal sessions and normal reconnects reuse that credential without another code until it expires (at most 30 days), is revoked, or browser storage is cleared. Revocation or loss of host credential storage currently requires manually clearing the browser's saved credential before pairing again; Retry does not replace it. Agent restart ends running terminals. To retain authorizations across host-agent restarts, use its existing explicit stable `-store` configuration; the harness default uses a temporary process-specific store.

Each authorized device creates independent terminal sessions on that host. A remembered session link can only reopen with its owning credential; another paired device cannot control that running session. The host's own browser follows the same authentication rules.

This client targets one configured host. Local/Private are configured connection modes, not a host registry. Browser credential storage currently has one active credential per web origin. Selecting several distinct hosts, shared terminal control, and Linux/mobile agents are future work.

## Leave and recover a running terminal

Disconnect (or Detach) releases the browser connection and leaves the host terminal running. End Terminal explicitly closes it. New Session ends the current terminal and creates another. Browser backgrounding, closure and transport loss preserve the session locator; reconnect authenticates before reopening that same session.

Foreground recovery makes at most eight attempts, delayed by 0.5, 1, 2, 4, 8, 16, 16 and 16 seconds. This accommodates a stale connection while retaining host ownership checks. Repeated visibility events do not reset an exhausted attempt budget; explicit Retry can start a new episode. Authentication failures are not automatically retried. Multiple tabs can collectively reach the host's throttle, so recovery is not guaranteed.

After closing a tab, open the root page and explicitly select a Recent terminals entry, or use the original session fragment. A new root page never automatically takes an old terminal. The optional browser-local list stores at most twenty canonical locators/timestamps, scoped to the exact configured profile and credential. It stores no terminal content or credential secrets, tolerates unavailable storage, and forgets an entry after an acknowledged end or replacement. Entries are recovery suggestions, not proof that a host process remains alive.

History remains bounded in host memory (262,144 output bytes per session, 16,777,216 bytes across the agent). Host restart, process exit, expiry/revocation and explicit terminal end still remove the shell/history; no durable terminal archive is added.
