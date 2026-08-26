import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCommitObject,
  readTargetConfig,
  validateAdapter,
} from "./harness/target.mjs";

test("default target is explicitly labelled as a test double", () => {
  const config = readTargetConfig({});
  assert.equal(config.mode, "labelled-double");
  assert.equal(config.expectedEvidenceClass, "labelled-test-double");
  assert.equal(config.candidateSha, null);
});

test("unknown target modes fail closed", () => {
  assert.throws(
    () => readTargetConfig({ TERMINUS_CONTRACT_TARGET: "maybe-real" }),
    /Unsupported TERMINUS_CONTRACT_TARGET/,
  );
});

test("real mode refuses a missing adapter", () => {
  assert.throws(
    () => readTargetConfig({ TERMINUS_CONTRACT_TARGET: "real" }),
    /requires TERMINUS_CONTRACT_ADAPTER/,
  );
});

test("real mode refuses a non-immutable candidate reference", () => {
  assert.throws(
    () =>
      readTargetConfig({
        TERMINUS_CONTRACT_TARGET: "real",
        TERMINUS_CONTRACT_ADAPTER: "adapter.mjs",
        TERMINUS_CONTRACT_CANDIDATE_SHA: "session/02-web",
      }),
    /40-character TERMINUS_CONTRACT_CANDIDATE_SHA/,
  );
});

test("real adapter metadata must match the selected candidate", () => {
  const candidateSha = "a".repeat(40);
  const config = readTargetConfig({
    TERMINUS_CONTRACT_TARGET: "real",
    TERMINUS_CONTRACT_ADAPTER: "adapter.mjs",
    TERMINUS_CONTRACT_CANDIDATE_SHA: candidateSha,
  });
  assert.throws(
    () =>
      validateAdapter(
        {
          metadata: {
            evidenceClass: "real-consumer",
            candidateSha: "b".repeat(40),
          },
          invoke() {},
        },
        config,
      ),
    /candidateSha does not match/,
  );
});

test("real candidate SHA must resolve to a commit object", () => {
  assert.throws(
    () => assertCommitObject("0".repeat(40)),
    /does not resolve to a local Git commit object/,
  );
});
