---
name: terminus-web
description: Build and verify the Terminus Next.js web/PWA client within Session 02 ownership. Use for responsive terminal UI, browser protocol consumption, and PWA behavior; not backend, Windows-agent, or deployment work.
---

# Terminus Web

Read the repository `AGENTS.md` and follow its required read order. Then read [the Session 02 brief](../../../agents/session-02-web.md), ownership map, task queue, and Session 02 status.

Edit only `apps/web/**` and the Session 02 status. Keep test doubles clearly labelled. Consume versioned protocol fixtures without redefining them. Verify dependencies from the lockfile/types or primary documentation, and report real browser evidence separately from mocked results.

Do not deploy, edit CI, or change shared contracts. The only scope exceptions are source-owned immutable requests and target-owned immutable responses using the coordination ownership patterns.
