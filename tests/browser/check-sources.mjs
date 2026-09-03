import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const roots = [
  new URL("./", import.meta.url),
  new URL("../contract/", import.meta.url),
  new URL("../integration/", import.meta.url),
];
const sourceExtensions = new Set([".js", ".mjs"]);
const jsonExtensions = new Set([".json", ".webmanifest"]);
let checkedSources = 0;
let checkedJson = 0;

for (const root of roots) await inspect(root);
process.stdout.write(
  `syntax-valid sources=${checkedSources} json=${checkedJson}\n`,
);

async function inspect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "test-results")
      continue;
    const url = new URL(
      entry.name + (entry.isDirectory() ? "/" : ""),
      directory,
    );
    if (entry.isDirectory()) {
      await inspect(url);
      continue;
    }

    const extension = entry.name.endsWith(".webmanifest")
      ? ".webmanifest"
      : entry.name.slice(entry.name.lastIndexOf("."));
    if (sourceExtensions.has(extension)) {
      const result = spawnSync(
        process.execPath,
        ["--check", fileURLToPath(url)],
        { encoding: "utf8" },
      );
      if (result.status !== 0) {
        if (result.error) throw result.error;
        process.stderr.write(
          result.stderr ||
            result.stdout ||
            `Syntax check failed: ${entry.name}\n`,
        );
        process.exit(1);
      }
      checkedSources += 1;
    } else if (jsonExtensions.has(extension)) {
      JSON.parse(await readFile(url, "utf8"));
      checkedJson += 1;
    }
  }
}
