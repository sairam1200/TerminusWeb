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
