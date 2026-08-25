# Vercel verification boundary

Session 06 does not deploy from this directory. A future preview verification run must receive a separately authorized HTTPS preview URL through `TERMINUS_BROWSER_BASE_URL` and must record the exact web task commit SHA.

A preview proves only the served web/PWA asset path. It does not prove that terminal frames bypass Vercel, that the Windows endpoint is Tailscale-private, or that the browser-to-agent WSS path works. Those claims require the separate real integration, allowed/denied network, and log-redaction gates defined for S06-002.

No Vercel token, project identifier containing credentials, pairing material, terminal content, or reusable authentication data belongs in this directory.
