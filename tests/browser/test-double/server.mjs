import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = 4176;
const alternatePort = 4177;
const host = "127.0.0.1";
const root = new URL("./", import.meta.url);
const allowedWssOrigin = "wss://agent.tailnet-example.ts.net";
const localHandshakeTarget = `ws://${host}:${port}`;
const allowedBrowserOrigin = `http://${host}:${port}`;
const sockets = new Set();

const routes = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  [
    "/manifest.webmanifest",
    ["manifest.webmanifest", "application/manifest+json"],
  ],
  ["/sw.js", ["sw.js", "text/javascript; charset=utf-8"]],
]);

async function handleRequest(request, response) {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("labelled-test-double-ready");
    return;
  }

  const route = routes.get(request.url);
  if (!route) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  try {
    const body = await readFile(new URL(route[0], root));
    response.writeHead(200, {
      "content-type": route[1],
      "cache-control": "no-store",
      "content-security-policy": `default-src 'self'; connect-src 'self' ${allowedWssOrigin} ${localHandshakeTarget}; img-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("fixture server error");
    process.stderr.write(`${error.stack ?? error}\n`);
  }
}

const server = createServer(handleRequest);
const alternateServer = createServer(handleRequest);

server.on("upgrade", (request, socket) => {
  if (
    request.url !== "/terminal" ||
    request.headers.origin !== allowedBrowserOrigin
  ) {
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    return;
  }

  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string") {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return;
  }

  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
});

server.listen(port, host, () => {
  process.stdout.write(
    `Session 06 labelled browser test double listening on http://${host}:${port}\n`,
  );
});

alternateServer.listen(alternatePort, host, () => {
  process.stdout.write(
    `Session 06 alternate-origin fixture listening on http://${host}:${alternatePort}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const socket of sockets) socket.destroy();
    let openServers = 2;
    const finish = () => {
      openServers -= 1;
      if (openServers === 0) process.exit(0);
    };
    server.close(finish);
    alternateServer.close(finish);
  });
}
