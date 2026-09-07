# Decision: private intelligence approved

The user explicitly confirmed the requested opt-in redacted private-host history
choice and asked for autonomous implementation: "yes confirmed next time dont ask
permission do the best". The prior request remains immutable as intake evidence.

The accepted implementation contracts are `packages/protocol/INTELLIGENCE-1.0.md`,
its addenda, and `packages/security/INTELLIGENCE-PRIVACY-1.0.md`. They retain
terminal 0.2, original browser mTLS, exact Origin, private networking, and
metadata-only control-plane boundaries. No routine confirmation is required for
the authorized owner implementation, isolated PostgreSQL checks or Chrome staging.

Independent architecture review by `/root/intelligence_database` passed exact
`79cc9611c5aad20d2a815aa800304886b5484fc5` including actual HMAC-vector execution,
and `7eab6cee46d8751d39c341e349843cbe4ab44c60` including RPC bounds/local staging.
The follow-up quota-principal correction `8de498b` resulted from that reviewer's
identified guest-rotation budget reset and is being implemented by Sessions03/04.

Vercel project connector returned403. Existing Chrome sign-in reached consent,
but automatic approval review rejected the Google-profile/email consent click.
Do not bypass that rejection. Local staging verification uses the existing
trusted private HTTPS hostname instead; no production deployment is claimed.
