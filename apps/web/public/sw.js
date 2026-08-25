/* Terminus scaffold service worker: deliberately stores no terminal or user data. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
