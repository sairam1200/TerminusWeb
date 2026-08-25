import { expect, test } from "@playwright/test";

import {
  evidence,
  induceDisconnect,
  readRecordedEvents,
  selectors,
} from "../support/profile.mjs";

test("reconnect reports state and restores terminal focus", async ({
  page,
}, testInfo) => {
  testInfo.annotations.push({
    type: "evidence-class",
    description: evidence.evidenceClass,
  });
  await page.goto("/");
  await page.locator("body").focus();
  await induceDisconnect(page);
  await expect(page.locator(selectors.status)).toHaveText("Reconnecting");
  await expect(page.locator(selectors.status)).toHaveText("Connected");
  await expect(page.locator(selectors.terminal)).toBeFocused();

  const events = await readRecordedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "reconnecting" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ type: "reconnected" }),
  );
});
