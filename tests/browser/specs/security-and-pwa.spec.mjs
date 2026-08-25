import { expect, test } from "@playwright/test";

import {
  approvedDestination,
  evidence,
  readRecordedEvents,
  rejectedDestination,
  selectors,
} from "../support/profile.mjs";

test.beforeEach(({}, testInfo) => {
  testInfo.annotations.push({
    type: "evidence-class",
    description: evidence.evidenceClass,
  });
});

test("CSP is restrictive and names the approved WSS destination", async ({
  page,
}) => {
  const response = await page.goto("/");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain(approvedDestination);
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).not.toMatch(/connect-src[^;]*\*/);
});

test("unapproved WebSocket origin is rejected before a connection attempt", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator(selectors.destination).fill(rejectedDestination);
  await page.locator(selectors.connect).click();
  await expect(page.locator(selectors.status)).toHaveText(
    "Rejected unapproved destination",
  );

  const events = await readRecordedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "origin-rejected" }),
  );
  expect(events).not.toContainEqual(
    expect.objectContaining({ type: "origin-approved" }),
  );
});

test("approved exact WebSocket destination is accepted", async ({ page }) => {
  await page.goto("/");
  await page.locator(selectors.destination).fill(approvedDestination);
  await page.locator(selectors.connect).click();
  await expect(page.locator(selectors.status)).toHaveText("Connected");

  const events = await readRecordedEvents(page);
  expect(events).toContainEqual(
    expect.objectContaining({ type: "origin-approved" }),
  );
});

test("PWA manifest declares a standalone launch surface", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator("link[rel='manifest']")).toHaveAttribute(
    "href",
    /manifest\.webmanifest$/,
  );
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBeTruthy();
  const manifest = await response.json();
  expect(manifest).toMatchObject({ start_url: "/", display: "standalone" });
});
