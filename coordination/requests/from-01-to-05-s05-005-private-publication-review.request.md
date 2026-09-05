# Session 01 request: S05-005 private TLS/publication review

- Source: Session 01 (`session/01-architecture`)
- Target: Session 05 (`session/05-security-network`)
- Task: `S05-005`
- Blocks: `S02-002` real private-WSS browser evidence and downstream S05-002/S06-002 verification

## Scope

Review the exact S03-003 TLS/listener/host design and prove the intended private
access boundary without modifying product code or live infrastructure. This task
is read-only unless the user separately authorizes a live tailnet mutation.

The review must cover:

- intended private Tailscale access to the exact endpoint and serialized HTTPS Origin;
- denied LAN, wildcard, public, and unintended listener paths;
- existing browser/OS certificate hostname and trust-chain evidence (no trust-store mutation);
- Funnel disabled and no public exposure;
- distinction between local origin, Tailscale identity/policy, certificate trust, and application pairing/authentication.

## Required evidence for handoff

- Exact S03-003 product/host commit and configuration inputs reviewed; no secrets in artifacts.
- At least one intended allowed private path and denied LAN/public path, with exact commands/results.
- Certificate trust verification without installing or weakening validation.
- Funnel-disabled/read-only policy evidence, or an explicit blocker where live inspection is unavailable.
- No live mutation, deployment, DNS change, certificate installation, or public exposure.
- Named independent read-only reviewer and separate status-only handoff commit.
