const allowedDestination = "wss://agent.tailnet-example.ts.net";
const localHandshakeDestination = "ws://127.0.0.1:4176/terminal";
const terminal = document.querySelector("[data-testid='terminal-input']");
const status = document.querySelector("[data-testid='connection-status']");
const destination = document.querySelector("[data-testid='destination']");
const viewportSize = document.querySelector("[data-testid='viewport-size']");

window.__terminusHarness = {
  evidenceClass: "labelled-test-double",
  candidateSha: null,
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

terminal.addEventListener("paste", (event) => {
  record("paste", {
    plainText: event.clipboardData?.types.includes("text/plain") ?? false,
    length: event.clipboardData?.getData("text/plain").length ?? 0,
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

    if (
      requestedOrigin !== allowedDestination &&
      destination.value !== localHandshakeDestination
    ) {
      status.textContent = "Rejected unapproved destination";
      record("destination-rejected", { requestedOrigin });
      return;
    }

    if (destination.value === localHandshakeDestination) {
      const socket = new WebSocket(localHandshakeDestination);
      socket.addEventListener("open", () => {
        status.textContent = "Connected";
        record("handshake-origin-accepted", {
          pageOrigin: window.location.origin,
        });
        terminal.focus();
      });
      socket.addEventListener("error", () => {
        status.textContent = "Rejected browser origin";
        record("handshake-origin-rejected", {
          pageOrigin: window.location.origin,
        });
      });
      return;
    }

    status.textContent = "Approved destination";
    record("destination-approved", { requestedOrigin });
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
