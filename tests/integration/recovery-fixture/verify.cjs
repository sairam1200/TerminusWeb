// Actual TS adapter <-> actual Go endpoint; all resources synthetic/local.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { webcrypto } = require("node:crypto");

const web = path.resolve(process.argv[2]);
const fixture = path.resolve(process.argv[3]);
const ts = require(path.join(web, "node_modules/typescript"));
// Compile unchanged installed-source TS modules in memory. No product files.
require.extensions[".ts"] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
const { ProtocolTerminalAdapter } = require(
  path.join(web, "terminal/protocolTerminalAdapter.ts"),
);
const { MemoryCredentialStore } = require(
  path.join(web, "protocol/credentialStore.ts"),
);
// Installed Playwright 1.62.1 exports its bundled ws client from utilsBundle;
// verified against that installed source. Use its explicit CA option.
const { ws: WebSocket } = require(
  path.join(process.argv[4], "node_modules/playwright-core/lib/utilsBundle.js"),
);
const origin = "https://127.0.0.1:4192";
const child = spawn(fixture, [], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
let adapter;
let fixtureErrors = 0;
child.stderr.on("data", () => fixtureErrors++);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, description) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    if (await check()) return;
    await delay(20);
  }
  throw Error(description);
}
async function main() {
  const setup = await new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(
      () => reject(Error("fixture startup timeout")),
      10000,
    );
    lines.once("line", (line) => {
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });
    child.once("error", () => reject(Error("fixture failed to start")));
  });
  assert.equal(new URL(setup.url).hostname, "127.0.0.1");
  const request = (route) =>
    new Promise((resolve, reject) => {
      https
        .get(setup.url + route, { ca: setup.ca }, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            res.statusCode >= 400
              ? reject(Error("fixture control failed"))
              : resolve(data ? JSON.parse(data) : undefined),
          );
        })
        .on("error", () => reject(Error("fixture control transport failed")));
    });
  const store = new MemoryCredentialStore(webcrypto);
  await store.saveCredential(
    "30000000-0000-4000-8000-000000000091",
    Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64url"),
    new Date(Date.now() + 3600000).toISOString(),
  );
  const sockets = [];
  const sent = [];
  let rendered = "";
  const createAdapter = () => {
    const next = new ProtocolTerminalAdapter({
      mode: "local",
      endpoint: setup.url.replace("https:", "wss:") + "/terminal",
      expectedWebOrigin: origin,
      getCurrentOrigin: () => origin,
      credentialStore: store,
      cryptoProvider: webcrypto,
      webSocketFactory: (url, protocol) => {
        const socket = new WebSocket(url, protocol, { ca: setup.ca, origin });
        const send = socket.send.bind(socket);
        socket.send = (data) => {
          const frame = JSON.parse(data);
          sent.push({
            type: frame.type,
            code: frame.payload.code,
            sessionId: frame.payload.sessionId,
          });
          return send(data);
        };
        sockets.push(socket);
        return socket;
      },
    });
    next.subscribeSession((event) => {
      if (event.type === "history-begin") rendered = "";
    });
    next.subscribeOutput((output) => (rendered += output));
    return next;
  };
  adapter = createAdapter();
  await adapter.connect();
  await until(
    () => adapter.getState() === "connected",
    "initial connection failed",
  );
  const first = adapter.getSessionId();
  assert.ok(first);
  await request("/fixture/emit");
  await until(
    () => rendered === "S06-SYNTHETIC-OUTPUT;",
    "initial output missing",
  );
  // Inject the browser transport error callback while the actual TLS socket is
  // still writable, which exposes erroneous fatal-frame emission reliably.
  sockets[0].onerror({ type: "error" });
  await delay(100);
  const failureFrames = sent.filter((frame) => frame.type === "error").length;
  await delay(2200); // Explicitly exceeds the user's observed two-second gap.
  await request("/fixture/emit");
  await adapter.connect();
  await until(
    () => adapter.getState() === "connected",
    "recovery did not connect",
  );
  const state = await request("/fixture/state");
  if (adapter.getSessionId() === first) {
    await until(
      () => rendered === "S06-SYNTHETIC-OUTPUT;S06-SYNTHETIC-OUTPUT;",
      "recovered output did not complete",
    );
  }
  const result = {
    sameSession: adapter.getSessionId() === first,
    opened: state.opened,
    closed: state.closed,
    fatalFrames: failureFrames,
    orderedHistory: rendered === "S06-SYNTHETIC-OUTPUT;S06-SYNTHETIC-OUTPUT;",
    reopenFrames: sent.filter((frame) => frame.type === "reopen_session")
      .length,
    boundary: "actual-adapter-endpoint-synthetic-PTY-store-resolver",
  };
  console.log(JSON.stringify(result));
  assert.equal(result.sameSession, true, "recovery replaced running session");
  assert.equal(result.opened, 1, "recovery created another PTY");
  assert.equal(result.closed, 0, "recoverable loss destroyed PTY");
  assert.equal(
    result.fatalFrames,
    0,
    "transport error emitted fatal protocol error",
  );
  assert.equal(
    result.orderedHistory,
    true,
    "retained history was not recovered in order",
  );
  // Model document replacement: dispose its transport and create a completely
  // new adapter that knows only the explicit locator and remembered credential.
  const oldSocket = sockets.at(-1);
  adapter.release();
  await until(
    () => oldSocket.readyState === 3,
    "old document socket stayed open",
  );
  adapter = createAdapter();
  rendered = "";
  await adapter.connect({ sessionId: first });
  await until(
    () => adapter.getState() === "connected",
    "new document did not reconnect",
  );
  await until(
    () => rendered === "S06-SYNTHETIC-OUTPUT;S06-SYNTHETIC-OUTPUT;",
    "new document history incomplete",
  );
  const after = await request("/fixture/state");
  assert.equal(adapter.getSessionId(), first);
  assert.deepEqual(after, { opened: 1, closed: 0 });
  assert.equal(
    sent.filter((frame) => frame.type === "pairing_request").length,
    0,
  );
  console.log(
    JSON.stringify({
      freshAdapterSameSession: true,
      rememberedCredential: true,
      orderedHistory: true,
      opened: after.opened,
      closed: after.closed,
    }),
  );
  assert.equal(fixtureErrors, 0, "fixture had unexpected diagnostics");
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (adapter) await adapter.disconnect().catch(() => {});
    child.stdin.end("stop\n");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      delay(3000),
    ]);
    if (child.exitCode === null) child.kill();
  });
