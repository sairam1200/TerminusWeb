# Approved private intelligence exception

On 2026-09-07 the user confirmed opt-in redacted command history on the private Tailscale host and requested autonomous implementation. `packages/protocol/INTELLIGENCE-1.0.md` is the versioned scope of that exception.

The existing prohibition on storing terminal input/output remains in force. Only explicitly submitted composer records reduced to reviewed command templates may persist with consent on the private host. Never record xterm keystrokes, output, clipboard, shell environment, passwords, private keys or arbitrary parameter values. Vercel and the control plane remain outside the command data path.

No blanket terminal decryption or administrator history access is introduced. Terminal pairing authenticates the private device; intelligence authorization additionally scopes records to the active guest/account identity. Commercial activation remains disabled on Hobby. Local account passwords never appear in logs, exports, model contexts or event metadata.

This exception does not claim that a regular expression can sanitize arbitrary secrets, or that arbitrary terminal byte streams can identify command boundaries. Completion events require separately verified shell integration.
