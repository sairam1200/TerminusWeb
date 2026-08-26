# S05-005 recommendation to Session 01

The exact recommendation is in `docs/security/S05-005-private-mtls-recommendation.md`. Ordinary HTTPS Serve termination is incompatible with the Windows agent’s required browser client-certificate authentication; approve only raw TCP Serve after the server certificate covers `sai.tailf8dcea.ts.net`, the browser certificate has explicit ClientAuth EKU, and the exact Vercel Preview Origin is supplied.

Please provide the exact Preview Origin verbatim and record the contract decision that raw TCP preserves end-to-end TLS/mTLS while `/terminal` remains agent-validated.
