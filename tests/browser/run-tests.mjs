import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.argv[2];
if (mode !== "labelled-double" && mode !== "real") {
  process.stderr.write("Usage: node run-tests.mjs <labelled-double|real>\n");
  process.exit(2);
}

const cli = fileURLToPath(
  new URL("./node_modules/@playwright/test/cli.js", import.meta.url),
);
const result = spawnSync(process.execPath, [cli, "test"], {
  cwd: import.meta.dirname,
  env: { ...process.env, TERMINUS_BROWSER_TARGET: mode },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
