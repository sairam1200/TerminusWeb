import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("terminal data persistence boundary", () => {
  it("keeps the credential database free of session and terminal records", () => {
    const credentialStore = source("./credentialStore.ts");

    expect(credentialStore).not.toMatch(
      /terminal_output|history_(?:begin|chunk|end)|sessionId/,
    );
  });

  it("does not give the service worker a terminal-data cache path", () => {
    const serviceWorker = source("../public/sw.js");

    expect(serviceWorker).not.toMatch(/addEventListener\(["']fetch["']/);
    expect(serviceWorker).not.toMatch(
      /\bcaches\b|CacheStorage|indexedDB|localStorage|sessionStorage/,
    );
  });

  it("keeps terminal rendering and transport out of Web Storage", () => {
    const shell = source("../components/TerminalShell.tsx");
    const adapter = source("../terminal/protocolTerminalAdapter.ts");

    expect(`${shell}\n${adapter}`).not.toMatch(
      /localStorage|sessionStorage|CacheStorage/,
    );
  });
});
