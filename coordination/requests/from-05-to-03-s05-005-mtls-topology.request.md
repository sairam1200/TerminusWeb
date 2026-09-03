# S05-005 recommendation to Session 03

Keep the agent on an explicit loopback listener and terminate TLS/mTLS in the agent. The proposed private publication is raw TCP Serve to `127.0.0.1:<verified-agent-port>` so the browser client certificate reaches `RequireAndVerifyClientCert`; ordinary HTTPS Serve termination must not be used. Reject the current `CN=localhost` server certificate for `sai.tailf8dcea.ts.net` and require a trusted ServerAuth certificate plus client-CA/browser certificate with explicit ClientAuth EKU. Do not change host or certificates under this request.
