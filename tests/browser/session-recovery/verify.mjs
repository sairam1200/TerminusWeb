import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const web = path.resolve(process.argv[2]);
const require = createRequire(
  path.join(path.resolve(process.argv[3]), "package.json"),
);
const { chromium, expect } = require("@playwright/test");
const { createServer } = await import(
  pathToFileURL(path.join(web, "node_modules/vite/dist/node/index.js"))
);
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.resolve(root, "../output/playwright/S06-013");
await mkdir(output, { recursive: true });
const server = await createServer({
  root,
  configFile: false,
  cacheDir: path.resolve(root, "../../../tmp/s06-recovery-vite-cache"),
  define: { "process.env": "{}" },
  resolve: {
    alias: {
      "@host-web": web,
      "react-dom": path.join(web, "node_modules/react-dom"),
      react: path.join(web, "node_modules/react"),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 4193,
    strictPort: true,
    fs: { allow: [root, web] },
  },
  oxc: { jsx: { runtime: "automatic" } },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ channel: "chrome", headless: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width === 390,
      hasTouch: viewport.width === 390,
    });
    const page = await context.newPage();
    let errors = 0,
      external = 0;
    page.on("pageerror", () => errors++);
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).hostname !== "127.0.0.1") {
        external++;
        return route.abort();
      }
      return route.continue();
    });
    await page.goto("http://127.0.0.1:4193");
    const recent = page.getByRole("region", { name: "Recent terminals" });
    await expect(recent).toBeVisible();
    assert.equal(
      await page.evaluate(() => window.s06Recovery.connects),
      0,
      "root silently reopened recent terminal",
    );
    await page.screenshot({
      path: path.join(output, `${viewport.width}-recent.png`),
      fullPage: true,
    });
    await recent
      .getByRole("button", { name: "k7m4-p2q9-wxyz", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "End Terminal", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(() => window.s06Recovery.selected),
      "k7m4-p2q9-wxyz",
    );
    await expect(
      page.getByText(
        "Disconnect keeps this terminal running. New Session ends this terminal and opens another.",
        { exact: true },
      ),
    ).toBeVisible();
    // Browser lifecycle events are simulated; actual component/controller runs.
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(
        new PageTransitionEvent("pagehide", { persisted: true }),
      );
    });
    await page.waitForTimeout(2200);
    assert.equal(await page.evaluate(() => window.s06Recovery.ends), 0);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(() => page.evaluate(() => window.s06Recovery.reopens))
      .toBe(2);
    assert.equal(
      await page.evaluate(() => window.s06Recovery.selected),
      "k7m4-p2q9-wxyz",
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(recent).toBeVisible();
    await page.waitForTimeout(700);
    assert.equal(
      await page.evaluate(() => window.s06Recovery.reopens),
      2,
      "explicit disconnect auto-reconnected",
    );
    assert.equal(await page.evaluate(() => window.s06Recovery.ends), 0);
    await recent
      .getByRole("button", { name: "k7m4-p2q9-wxyz", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Switch to Swedish", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Avsluta terminal", exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: path.join(output, `${viewport.width}-connected-sv.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Avsluta terminal", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Senaste terminaler" }),
    ).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.s06Recovery.ends), 1);
    assert.equal(await page.evaluate(() => location.hash), "");
    assert.equal(errors, 0);
    assert.equal(external, 0);
    console.log(
      JSON.stringify({
        viewport,
        explicitRecent: true,
        lifecycleSameSession: true,
        disconnectRetained: true,
        endRemoved: true,
        languages: ["en", "sv"],
        pageErrors: errors,
        externalRequests: external,
        boundary: "actual-component-synthetic-adapter-lifecycle-events",
      }),
    );
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}
