# S03-001 resumed ConPTY attachment blocker

- Source: Session 03
- Target: Session 01
- Task: S03-001
- Requested queue action: return S03-001 to blocked; do not make S03-002 ready
- Protocol/security compatibility impact: none; no WSS, protocol 0.1, listener, or transport behavior was added

## Fresh diagnostic evidence

Session 03 reread the authoritative queue from `session/01-architecture` at
`a07e570113a6a88ac935c1c23f93ba02373428c7`; S03-001 was `ready` with no
dependencies. The resumed run started from exact prior product commit
`0dd577f0d0f2432ab411394b23a6a72eee44c4f9` and used a checksum-verified,
temporary Go 1.25.12 Windows AMD64 toolchain from a non-elevated process.

Three focused real-Windows attempts reproduced the same underlying condition:

1. Exact `0dd577f`, using `-NoExit -Command -`, failed in 0.27 seconds with
   `read conpty-output: file already closed`.
2. Replacing the vet-reported `unsafe.Pointer(HPCON)` use with a direct
   `UpdateProcThreadAttribute` call that passed the documented HPCON value
   failed in 0.25 seconds with the same closed-output condition.
3. Retaining the direct attribute call and switching PowerShell to the
   documented ordinary console invocation (`-NoLogo -NoProfile`) failed in
   0.26 seconds. This time the PowerShell prompt appeared on the Go test
   runner's console before the pipe closed.

The third observation proves that the created PowerShell process is using the
test runner's inherited console instead of the pseudoconsole. Both
`UpdateProcThreadAttribute` variants returned success, so neither the PowerShell
CLI mode nor the vet-safe handle representation by itself repairs attachment.
The experimental product edits were reverted; no knowingly failing product
change is being handed off.

## Safe stop and remaining work

The fresh three-attempt safe-stop threshold is reached. S03-001 still needs:

- identification and correction of why `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE`
  is not effective for the created process;
- a vet-clean representation of the HPCON attribute;
- real input/output/resize proof; and
- process-tree cleanup proof for natural shell exit, timeout, cancellation,
  explicit close, and agent failure, plus applicable concurrency checks.

No shared-contract change is requested. This request is blocker evidence only,
not evidence that S03-001 is done or verified.
