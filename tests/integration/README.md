# Integration environment inputs

The validator reads the process environment directly and never loads `.env` files. `.env.example` contains names only. Runtime secret values belong in an authorized secret store or an ephemeral process environment and must never be written to reports, logs, fixtures, screenshots, or Git.

Evidence classes are separate:

- `labelled-test-double`: in-process or local fixture behavior only.
- `simulated`: a non-production multi-process simulation.
- `staging`: deployed test systems with no release claim.
- `real-device`: an explicitly identified physical-device path.

Real mode requires exact 40-character task commit SHAs for Sessions 01, 02, 03, and 05; an HTTPS browser URL; the exact HTTPS page origin allowed in the agent's WebSocket handshake policy; a private WSS endpoint; allowed and denied source labels; Windows version; log capture path; and ephemeral pairing material. The browser page origin and WSS destination are deliberately separate inputs. Real mode also requires `TERMINUS_AGENT_VISIBILITY=tailscale-private`. Validation reports variable names and classifications only, never values.

```powershell
npm test
$env:TERMINUS_EVIDENCE_CLASS = 'labelled-test-double'
npm run validate:double
npm run validate:real
```

`validate:real` validates input shape only. It does not prove reachability, Tailscale policy, application authentication, ConPTY behavior, log redaction, or a browser flow.
