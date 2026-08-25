import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRoot = path.resolve(root, "../../infrastructure/database");

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  }));
  return nested.flat();
}

test("owned text files have deterministic whitespace and parseable JSON", async () => {
  const files = [...await filesBelow(root), ...await filesBelow(databaseRoot)]
    .filter((file) => /\.(json|md|mjs|ps1|sql)$/.test(file));

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.equal(content.endsWith("\n"), true, `${file} must end with newline`);
    assert.equal(/[ \t]+$/m.test(content), false, `${file} has trailing whitespace`);
    assert.equal(content.includes("\t"), false, `${file} contains a tab`);
    if (file.endsWith(".json")) JSON.parse(content);
  }
});
