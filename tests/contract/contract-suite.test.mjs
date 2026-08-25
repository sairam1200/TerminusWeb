import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadTarget, readTargetConfig } from "./harness/target.mjs";

const config = readTargetConfig();
const target = await loadTarget(config);
const cases = JSON.parse(
  await readFile(
    new URL("./fixtures/harness-cases.json", import.meta.url),
    "utf8",
  ),
);

test(`evidence is labelled ${target.metadata.evidenceClass}`, () => {
  assert.equal(target.metadata.evidenceClass, config.expectedEvidenceClass);
  assert.match(target.metadata.label, /\S/);
});

test("harness case identifiers are unique", () => {
  assert.equal(new Set(cases.map(({ id }) => id)).size, cases.length);
});

for (const testCase of cases) {
  test(`${testCase.id} [${target.metadata.evidenceClass}]`, async () => {
    const actual = await target.invoke(structuredClone(testCase));
    assert.deepEqual(actual, testCase.expected);
  });
}
