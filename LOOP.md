# Agent Loop Policy

Every automated or repeated workflow uses this bounded shape:

1. Discover: read the assigned contract, task, owned files, and last failure.
2. Plan: state the smallest change and deterministic proof.
3. Act: edit only owned paths.
4. Observe: run the narrow checks and inspect actual output.
5. Verify: run the task acceptance checks and check the diff.
6. Handoff: update the owning session status with evidence.

Stop successfully only when the deterministic gate passes. Stop unsuccessfully after three attempts with the same underlying blocker. Never auto-merge, auto-push, auto-deploy, change live Tailscale state, or weaken tests.
