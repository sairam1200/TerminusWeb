import { spawnSync } from "node:child_process";

const mode = process.argv[2];
if (mode !== "labelled-double" && mode !== "real") {
  process.stderr.write("Usage: node run-tests.mjs <labelled-double|real>\n");
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  ["--test", "config.test.mjs", "contract-suite.test.mjs"],
  {
    cwd: import.meta.dirname,
    env: { ...process.env, TERMINUS_CONTRACT_TARGET: mode },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
