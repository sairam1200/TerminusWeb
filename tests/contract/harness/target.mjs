import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const immutableSha = /^[0-9a-f]{40}$/i;

export function readTargetConfig(environment = process.env) {
  const mode = environment.TERMINUS_CONTRACT_TARGET ?? "labelled-double";
  if (mode !== "labelled-double" && mode !== "real") {
    throw new Error(`Unsupported TERMINUS_CONTRACT_TARGET: ${mode}`);
  }

  if (mode === "labelled-double") {
    return Object.freeze({
      mode,
      adapterPath: new URL("../adapters/labelled-double.mjs", import.meta.url),
      candidateSha: null,
      expectedEvidenceClass: "labelled-test-double",
    });
  }

  const adapterValue = environment.TERMINUS_CONTRACT_ADAPTER?.trim();
  const candidateSha = environment.TERMINUS_CONTRACT_CANDIDATE_SHA?.trim();
  if (!adapterValue) {
    throw new Error("Real contract mode requires TERMINUS_CONTRACT_ADAPTER");
  }
  if (!candidateSha || !immutableSha.test(candidateSha)) {
    throw new Error(
      "Real contract mode requires a 40-character TERMINUS_CONTRACT_CANDIDATE_SHA",
    );
  }

  const adapterPath = isAbsolute(adapterValue)
    ? adapterValue
    : resolve(process.cwd(), adapterValue);
  return Object.freeze({
    mode,
    adapterPath: pathToFileURL(adapterPath),
    candidateSha: candidateSha.toLowerCase(),
    expectedEvidenceClass: "real-consumer",
  });
}

export async function loadTarget(config) {
  if (config.mode === "real") assertCommitObject(config.candidateSha);
  const adapter = await import(config.adapterPath.href);
  validateAdapter(adapter, config);
  return Object.freeze({
    metadata: Object.freeze({ ...adapter.metadata }),
    invoke: adapter.invoke,
  });
}

export function assertCommitObject(
  candidateSha,
  repositoryPath = process.cwd(),
) {
  const result = spawnSync(
    "git",
    ["cat-file", "-e", `${candidateSha}^{commit}`],
    {
      cwd: repositoryPath,
      encoding: "utf8",
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      "TERMINUS_CONTRACT_CANDIDATE_SHA does not resolve to a local Git commit object",
    );
  }
}

export function validateAdapter(adapter, config) {
  if (!adapter?.metadata || typeof adapter.invoke !== "function") {
    throw new Error(
      "Contract adapter must export metadata and invoke(testCase)",
    );
  }
  if (adapter.metadata.evidenceClass !== config.expectedEvidenceClass) {
    throw new Error(
      `Adapter evidenceClass must be ${config.expectedEvidenceClass}`,
    );
  }
  if (
    config.mode === "real" &&
    adapter.metadata.candidateSha?.toLowerCase() !== config.candidateSha
  ) {
    throw new Error(
      "Real adapter candidateSha does not match TERMINUS_CONTRACT_CANDIDATE_SHA",
    );
  }
}
