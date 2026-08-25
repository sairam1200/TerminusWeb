const allowedDestination = "wss://agent.tailnet-example.ts.net";
const terminal = document.querySelector("[data-testid='terminal-input']");
const status = document.querySelector("[data-testid='connection-status']");
const destination = document.querySelector("[data-testid='destination']");
const viewportSize = document.querySelector("[data-testid='viewport-size']");

window.__terminusHarness = {
  evidenceClass: "labelled-test-double",
  events: [],
};

function record(type, detail = {}) {
  window.__terminusHarness.events.push({ type, ...detail });
}

function updateViewport() {
  viewportSize.textContent = `${window.innerWidth}x${window.innerHeight}`;
  record("resize", {
    columnsHint: Math.floor(window.innerWidth / 9),
    rowsHint: Math.floor(window.innerHeight / 18),
  });
}

terminal.addEventListener("keydown", (event) => {
  record("keyboard", {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  });
});

document
  .querySelector("[data-testid='mobile-key-bar']")
  .addEventListener("click", (event) => {
    const key = event.target.dataset.key;
    if (!key) return;
    terminal.focus();
    record("mobile-key", { key });
  });

document
  .querySelector("[data-testid='connect']")
  .addEventListener("click", () => {
    let requestedOrigin;
    try {
      requestedOrigin = new URL(destination.value).origin;
    } catch {
      requestedOrigin = "invalid-url";
    }

    if (requestedOrigin !== allowedDestination) {
      status.textContent = "Rejected unapproved destination";
      record("origin-rejected", { requestedOrigin });
      return;
    }

    status.textContent = "Connected";
    record("origin-approved", { requestedOrigin });
    terminal.focus();
  });

document.querySelector("#interrupt").addEventListener("click", () => {
  status.textContent = "Reconnecting";
  record("reconnecting");
  window.setTimeout(() => {
    status.textContent = "Connected";
    terminal.focus();
    record("reconnected");
  }, 250);
});

window.addEventListener("resize", updateViewport);
window.addEventListener("load", () => {
  updateViewport();
  terminal.focus();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
});
