import assert from "node:assert/strict";
import test from "node:test";

import { validateEnvironment } from "./validate-environment.mjs";

test("labelled double profile is accepted and remains explicit", () => {
  const result = validateEnvironment(
    { TERMINUS_EVIDENCE_CLASS: "labelled-test-double" },
    "double",
  );
  assert.equal(result.ok, true);
  assert.equal(result.evidenceClass, "labelled-test-double");
});

test("real profile rejects missing inputs without printing values", () => {
  const secret = "never-print-this-pairing-material";
  const result = validateEnvironment(
    { TERMINUS_PAIRING_SECRET: secret },
    "real",
  );
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual(result.secretVariablesPresent, ["TERMINUS_PAIRING_SECRET"]);
});

test("real profile accepts exact SHAs, private-path classification, and safe URL schemes", () => {
  const sha = "a".repeat(40);
  const result = validateEnvironment(
    {
      TERMINUS_EVIDENCE_CLASS: "staging",
      TERMINUS_PROTOCOL_SHA: sha,
      TERMINUS_WEB_SHA: sha,
      TERMINUS_WINDOWS_AGENT_SHA: sha,
      TERMINUS_SECURITY_SHA: sha,
      TERMINUS_CONTRACT_ADAPTER: "tests/integration/contract-adapter.mjs",
      TERMINUS_BROWSER_BASE_URL: "https://preview.example.invalid",
      TERMINUS_BROWSER_PROFILE_MODULE: "tests/integration/browser-profile.mjs",
      TERMINUS_AGENT_WSS_URL: "wss://agent.example.ts.net/terminal",
      TERMINUS_EXPECTED_BROWSER_ORIGIN: "https://preview.example.invalid",
      TERMINUS_AGENT_VISIBILITY: "tailscale-private",
      TERMINUS_WINDOWS_VERSION: "recorded-by-real-run",
      TERMINUS_ALLOWED_SOURCE_LABEL: "allowed-test-node",
      TERMINUS_DENIED_SOURCE_LABEL: "denied-test-node",
      TERMINUS_LOG_CAPTURE_PATH: "runtime-only-log-capture",
      TERMINUS_PAIRING_SECRET: "runtime-only-secret",
    },
    "real",
  );
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test("real profile rejects insecure or mismatched endpoint inputs", () => {
  const sha = "b".repeat(40);
  const result = validateEnvironment(
    {
      TERMINUS_EVIDENCE_CLASS: "real-device",
      TERMINUS_PROTOCOL_SHA: sha,
      TERMINUS_WEB_SHA: sha,
      TERMINUS_WINDOWS_AGENT_SHA: sha,
      TERMINUS_SECURITY_SHA: sha,
      TERMINUS_CONTRACT_ADAPTER: "adapter.mjs",
      TERMINUS_BROWSER_BASE_URL: "http://preview.example.invalid",
      TERMINUS_BROWSER_PROFILE_MODULE: "browser-profile.mjs",
      TERMINUS_AGENT_WSS_URL: "ws://agent.example.ts.net/terminal",
      TERMINUS_EXPECTED_BROWSER_ORIGIN: "http://different.example.invalid/path",
      TERMINUS_AGENT_VISIBILITY: "public",
      TERMINUS_WINDOWS_VERSION: "recorded-by-real-run",
      TERMINUS_ALLOWED_SOURCE_LABEL: "allowed-test-node",
      TERMINUS_DENIED_SOURCE_LABEL: "denied-test-node",
      TERMINUS_LOG_CAPTURE_PATH: "runtime-only-log-capture",
      TERMINUS_PAIRING_SECRET: "runtime-only-secret",
    },
    "real",
  );
  assert.equal(result.ok, false);
  assert(
    result.errors.some((error) =>
      error.includes("TERMINUS_BROWSER_BASE_URL must use https:"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("TERMINUS_AGENT_WSS_URL must use wss:"),
    ),
  );
  assert(
    result.errors.some((error) =>
      error.includes("TERMINUS_EXPECTED_BROWSER_ORIGIN must use https:"),
    ),
  );
  assert(result.errors.some((error) => error.includes("browser page origin")));
  assert(result.errors.some((error) => error.includes("tailscale-private")));
});
