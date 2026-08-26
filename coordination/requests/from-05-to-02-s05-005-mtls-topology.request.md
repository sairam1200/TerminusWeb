# S05-005 recommendation to Session 02

Use the exact Vercel Preview Origin supplied by Session 01. Connect to `https://sai.tailf8dcea.ts.net/terminal` over a raw TCP private Serve forwarder; do not assume HTTPS Serve termination preserves the client certificate. Require browser trust for a server certificate covering the hostname and a client certificate with explicit ClientAuth EKU. Keep wrong-Origin, wrong-subprotocol, expired/revoked credential, and wrong-device failures negative.
