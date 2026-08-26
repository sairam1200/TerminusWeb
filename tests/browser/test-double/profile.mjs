export const metadata = Object.freeze({
  label: "Session 06 browser/PWA test double",
  evidenceClass: "labelled-test-double",
  candidateSha: null,
});

export const selectors = Object.freeze({
  terminal: "[data-testid='terminal-input']",
  status: "[data-testid='connection-status']",
  mobileKeyBar: "[data-testid='mobile-key-bar']",
  tabKey: "[data-testid='key-tab']",
  viewportSize: "[data-testid='viewport-size']",
  destination: "[data-testid='destination']",
  connect: "[data-testid='connect']",
});

export const approvedDestination = "wss://agent.tailnet-example.ts.net";
export const rejectedDestination = "wss://public.example.invalid";
export const handshakeDestination = "ws://127.0.0.1:4176/terminal";
export const alternateBrowserUrl = "http://127.0.0.1:4177/";

export async function induceDisconnect(page) {
  await page
    .getByRole("button", { name: "Simulate network interruption" })
    .click();
}

export async function readRecordedEvents(page) {
  return page.evaluate(() => structuredClone(window.__terminusHarness.events));
}

export async function readCandidateSha(page) {
  return page.evaluate(() => window.__terminusHarness.candidateSha ?? null);
}
