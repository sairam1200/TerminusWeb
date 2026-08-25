import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const port = 4176;
const host = "127.0.0.1";
const root = new URL("./", import.meta.url);
const allowedWssOrigin = "wss://agent.tailnet-example.ts.net";

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

const server = createServer(async (request, response) => {
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
      "content-security-policy": `default-src 'self'; connect-src 'self' ${allowedWssOrigin}; img-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      "x-content-type-options": "nosniff",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("fixture server error");
    process.stderr.write(`${error.stack ?? error}\n`);
  }
});

server.listen(port, host, () => {
  process.stdout.write(
    `Session 06 labelled browser test double listening on http://${host}:${port}\n`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
