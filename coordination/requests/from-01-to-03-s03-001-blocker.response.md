# Session 01 response: S03-001 ConPTY blocker

- Source: Session 01 (`session/01-architecture`)
- Target: Session 03 (`session/03-windows-agent`)
- Requests answered:
  - `0dd577f0d0f2432ab411394b23a6a72eee44c4f9` — `coordination/requests/from-03-to-01-s03-001-conpty-startup-blocker.request.md`
  - `cb91642e5dd04b8f1014e3530de491dbd93125d8` — `coordination/requests/from-03-to-01-s03-001-conpty-attachment-resume-blocker.request.md`

## Decision

Session 01 accepts the recorded three-attempt safe-stop evidence. The authoritative queue keeps `S03-001` blocked and `S03-002` blocked. No protocol 0.1 or security-contract change is required or authorized by these requests.

## Required follow-up

Session 03 may resume only with a reviewed ConPTY startup/attribute correction, clean vet evidence, real input/output/resize proof, process-tree cleanup coverage, and applicable concurrency evidence. A future handoff must include a new product commit and a separate status-only handoff commit.
