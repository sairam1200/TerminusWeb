import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("./app.js", import.meta.url), "utf8");

for (const outcome of ["open", "error"]) {
  test(`labelled double stays connecting until socket ${outcome}`, () => {
    const elements = new Map();
    const getElement = (selector) => {
      if (!elements.has(selector)) {
        elements.set(selector, {
          textContent: "Connected",
          value: "ws://127.0.0.1:4176/terminal",
          listeners: {},
          addEventListener(type, listener) {
            this.listeners[type] = listener;
          },
          focus() {},
        });
      }
      return elements.get(selector);
    };
    let pendingSocket;
    class PendingWebSocket {
      listeners = {};
      constructor() {
        pendingSocket = this;
      }
      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
    const window = {
      location: { origin: "http://127.0.0.1:4176" },
      addEventListener() {},
    };
    runInNewContext(source, {
      document: { querySelector: getElement },
      window,
      WebSocket: PendingWebSocket,
      URL,
    });
    getElement("[data-testid='connect']").listeners.click();
    const status = getElement("[data-testid='connection-status']");
    assert.equal(status.textContent, "Connecting");
    assert.equal(window.__terminusHarness.events.length, 0);
    pendingSocket.listeners[outcome]();
    assert.equal(
      status.textContent,
      outcome === "open" ? "Connected" : "Rejected browser origin",
    );
    assert.equal(
      window.__terminusHarness.events[0].type,
      outcome === "open"
        ? "handshake-origin-accepted"
        : "handshake-origin-rejected",
    );
  });
}
