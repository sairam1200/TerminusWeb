import { expect, test } from "@playwright/test";

import {
  evidence,
  readRecordedEvents,
  selectors,
} from "../support/profile.mjs";

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: "evidence-class",
    description: evidence.evidenceClass,
  });
  testInfo.annotations.push({
    type: "target-label",
    description: evidence.label,
  });
  await page.goto("/");
});

test("layout fits desktop and iPhone-sized viewports without horizontal overflow", async ({
  page,
}, testInfo) => {
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  await expect(page.locator(selectors.terminal)).toBeVisible();

  const keyBar = page.locator(selectors.mobileKeyBar);
  if (testInfo.project.name.includes("iphone")) {
    await expect(keyBar).toBeVisible();
  } else {
    await expect(keyBar).toBeHidden();
  }
});

test("terminal receives keyboard input and the mobile key bar restores focus", async ({
  page,
}) => {
  const terminal = page.locator(selectors.terminal);
  await expect(terminal).toBeFocused();
  await terminal.press("Enter");
  await page.setViewportSize({ width: 390, height: 664 });
  await expect(page.locator(selectors.mobileKeyBar)).toBeVisible();
  await page.locator(selectors.tabKey).click({ force: true });
  await expect(terminal).toBeFocused();

  const events = await readRecordedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "keyboard",
      keyClass: "control",
      controlKey: "Enter",
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: "mobile-key", key: "Tab" }),
  );
});

test("viewport resize is propagated to the terminal adapter boundary", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await expect(page.locator(selectors.viewportSize)).toHaveText("390x664");

  const events = await readRecordedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({
      type: "resize",
      columnsHint: expect.any(Number),
      rowsHint: expect.any(Number),
    }),
  );
});

test("plain-text paste reaches the adapter boundary without recording pasted content", async ({
  page,
}) => {
  await page.locator(selectors.terminal).evaluate((terminal) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "x");
    terminal.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, clipboardData: clipboard }),
    );
  });

  const pasteEvent = (await readRecordedEvents(page)).find(
    ({ type }) => type === "paste",
  );
  expect(pasteEvent).toEqual({ type: "paste", plainText: true, length: 1 });
  expect(pasteEvent).not.toHaveProperty("content");
});

test("terminal controls expose accessible names and live connection status", async ({
  page,
}) => {
  await expect(page.locator(selectors.terminal)).toHaveAccessibleName(
    "Terminal input",
  );
  await expect(page.locator(selectors.destination)).toHaveAccessibleName(
    "Private WebSocket destination",
  );
  await expect(page.locator(selectors.connect)).toHaveAccessibleName("Connect");
  await expect(page.locator(selectors.status)).toHaveAttribute(
    "role",
    "status",
  );
  await page.setViewportSize({ width: 390, height: 664 });
  await expect(page.locator(selectors.mobileKeyBar)).toBeVisible();
  await expect(page.locator(selectors.mobileKeyBar)).toHaveAccessibleName(
    "Mobile terminal keys",
  );
});
