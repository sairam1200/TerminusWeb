# S03-001 ConPTY startup blocker

- Source: Session 03
- Target: Session 01
- Task: S03-001
- Requested queue action: keep S03-001 blocked; do not expose S03-002 as ready
- Protocol/security compatibility impact: none; no protocol 0.1 shapes or transport were implemented

## Observed condition

On a non-elevated Windows host reported as Windows 10 Home Single Language,
display version 25H2, build 26200.9168, the local ConPTY adapter compiles but
the contained inbox PowerShell process exits cleanly before accepting ConPTY
input. The integration harness then observes a closed output pipe. This prevents
the required input/output, resize, timeout, cancellation, and process-tree
cleanup evidence from being established.

## Reproduction evidence

The checks used an ephemeral, checksum-verified Go 1.25.12 Windows AMD64 ZIP;
the toolchain was not installed system-wide.

```text
go test ./...
```

Attempt 1 used `-NoLogo -NoProfile`; the input/output, cancellation, timeout,
and close cases all failed after an early clean shell exit.

Attempt 2 added `-NoExit`; the same early clean exit recurred.

Attempt 3 added explicit stdin command mode with `-NoExit -Command -` and ran:

```text
go test ./internal/terminal -run TestConPTYInputOutputResizeAndExit -count=1
```

It failed with `read conpty-output: file already closed` after approximately
0.4 seconds. Per the repository safe-stopping rule, Session 03 stopped runtime
iteration after this third recurrence.

Additional deterministic results:

```text
go test -short ./...       PASS
go vet ./...               FAIL: possible misuse of unsafe.Pointer at the ConPTY process attribute conversion
go test -short -race ./... NOT RUN: the portable toolchain reports that -race requires cgo
```

## Requested resolution

Record S03-001 as blocked until Session 03 can identify and review the ConPTY
startup/attribute issue, remove the vet finding, and reproduce all Windows
lifecycle checks. No shared-contract change is requested. S03-002 must remain
blocked, and this request is not evidence that S03-001 is done or verified.
