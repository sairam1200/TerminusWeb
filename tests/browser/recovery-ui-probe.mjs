import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

// Actual Next.js UI, using its explicitly labelled MockTerminalAdapter only.
// Run the candidate on loopback port 4188 with all NEXT_PUBLIC_* unset.
// No terminal, credentials, private endpoint or live agent is exercised.
const browser = await chromium.launch();
try {
  await mkdir("evidence/S06-008", { recursive: true });
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
    page.setDefaultTimeout(10000);
    const errors = [];
    const consoleProblems = [];
    const externalRequests = [];
    page.on("pageerror", (error) => errors.push(error.name));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()))
        consoleProblems.push(message.type());
    });
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "127.0.0.1")
        externalRequests.push(request.resourceType());
    });
    const response = await page.goto("http://127.0.0.1:4188");
    assert.match(
      response.headers()["content-security-policy"],
      /connect-src 'self';/,
    );
    await expect(
      page.getByRole("button", { name: "Start simulation", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("SIMULATED UI — NO TERMINAL CONNECTION", { exact: true }),
    ).toBeVisible();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: `evidence/S06-008/disconnected-${viewport.width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Configuration", exact: true })
      .click();
    await page.getByRole("button", { name: "Cyan", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Cyan", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Large", exact: true }).click();
    await page
      .getByRole("button", { name: "Configuration", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Switch to Swedish", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Terminalarbetsyta" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Byt till engelska", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start simulation", exact: true })
      .click();
    await expect(
      page.getByLabel("Simulation input", { exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Send Tab", exact: true }).click();
    await expect(
      page.getByLabel("Simulation input", { exact: true }),
    ).toBeFocused();
    await page.setViewportSize({
      width: viewport.height,
      height: viewport.width,
    });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(
      page.getByLabel("Simulation input", { exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Start simulation", exact: true })
      .click();
    await expect(
      page.getByLabel("Simulation input", { exact: true }),
    ).toBeEnabled();
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleProblems, []);
    assert.deepEqual(externalRequests, []);
    console.log(
      `PASS actual-UI local-simulation ${viewport.width}x${viewport.height}: layout, settings, language, start, keyboard focus, rotation, disconnect, restart, self-only CSP; pageerrors=0 consoleProblems=0 externalRequests=0`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
