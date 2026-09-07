# S01-010 authorized prototype publication manifest

User request: commit and push to main for deployment (2026-09-07).
Base: f3e5bd6063c13ea79e5d585dab3f45f7658e15fb.
Integration uses the following immutable product deltas, in order; status-only commits excluded.

## Product inputs

- 1a9e7952fba1391aef3894d2f0c96121a66d6129 - docs(S01-008): define private session intelligence capability
- 2d51f463b10821b495169f83d3254f5c4a83f09c - docs(S01-008): add auth vectors and intelligence delivery tasks
- 79cc9611c5aad20d2a815aa800304886b5484fc5 - test(S01-008): verify intelligence authentication vectors
- 7eab6cee46d8751d39c341e349843cbe4ab44c60 - docs(S01-008): freeze RPC boundaries and local staging flow
- 8de498baed6ca40b8a98be0bc0a6a16718356c04 - docs(S01-008): preserve model quota across guest identity rotation
- c1434c9b3edb8fc117a86caf1b071d0a98e559c5 - docs(S01-008): record approved private intelligence architecture
- 3efefd6d83033743857ce6d4b88bd41b9bd55cfc - docs(S01-008): bound complete history exports with owner scoped cursors
- 0880d482c5426fd95f35c24994e40652a1d74b3d - S01-009 record user supplied Terminus Web instructions
- ab5708024d540d945d001e35f794341128f23a16 - S04-003 add private intelligence PostgreSQL schema and invariants
- 3f09b8ca7e98d06d1dc869a2fed1cc337b0cb91d - S04-003 align identity limits with intelligence RPC addendum
- 33cc6383ff6af9a049113206a6a57d8690936de2 - S04-003 preserve paired device quota across guest identity rotation
- 9c49d8168262f98f42d7354df7c314e4930b9d4f - S03-009 implement private authenticated session intelligence
- 3131ae164ba32465aa54c74d3871982c61061675 - S03-009 bound exports and release authentication admission promptly
- a6adf52afeeb87ad9e6907c79baa9c9023c562a4 - S03-009 bound model reconciliation latency
- 4f1de89da47254c7575650c34ab70c56df11121f - S03-009 clarify local pairing approval metadata
- a5d958990d9ef3f38224116640e8d569c3977733 - S02-007 implement private intelligence client and dashboards
- 24e1821471785f8416ba155abedb2c729b06ab85 - S02-007 fence session intelligence and paginate private export
- cd6a1ef32e40f41ebada2b5a36cdcbefb90346ea - S02-007 align private password input with UTF-8 bounds
- 88108ff96d3294ea5230a467595a68d783ea1840 - S02-008 distinguish unavailable transport and link configured origins
- e722e0e91f8157f0f498d8c32b00f7fce5f942d1 - S06-009 record independent private intelligence component verification
- 2bf6fb851f159875bc16af6761db0c2255eccaa6 - S06-009 record independent unpaired Chrome responsive layout
- 5336d6282b04165b0969138c8727966609fb8dab - S06-009 verify authenticated WSS service with real PostgreSQL
- 3d4d0daccd487c6489cb9133798aee1d7589fd8d - S06-009 verify paired private Chrome privacy and usage reads

## Evidence and scope

Independent Session 06 evidence e722e0e, 2bf6fb8, 5336d62 and 3d4d0da reproduces component, responsive unpaired Chrome, real WSS-service-PostgreSQL and authenticated private Privacy/Usage checks. Final web88108ff is reviewed with owner123 tests and root10 regression tests; integrated candidate receives independent Session06 checks before publication.

This is explicit user-authorized source and personal prototype publication, not a full verified release. Existing RESOURCE-001 replay snapshot memory accounting remains unresolved; broader live composer/account/export/reconnect/mobile flows remain unverified. Running private backend is not restarted or reconfigured. Its exact allowed Origin remains the private site; Vercel-origin terminal connectivity is not implied by asset publication. No production database migration or live model service is introduced.

Main protection is preserved: push isolated branch, create PR, merge after candidate checks using exact head guard. Every new commit includes the requested co-author trailer. No source-session history is rewritten.

Rollback: revert the new integration commit through a follow-up PR to restore the previous source tree. Verify reverse application in an isolated staging worktree before merge; do not execute production rollback. Production deployment status must come from actual GitHub/Vercel evidence.
