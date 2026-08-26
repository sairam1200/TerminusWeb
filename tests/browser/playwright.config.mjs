import { spawnSync } from "node:child_process";
import { defineConfig, devices } from "@playwright/test";

const mode = process.env.TERMINUS_BROWSER_TARGET ?? "labelled-double";
if (mode !== "labelled-double" && mode !== "real") {
  throw new Error(`Unsupported TERMINUS_BROWSER_TARGET: ${mode}`);
}

const isReal = mode === "real";
const baseURL = isReal
  ? requireHttpsUrl(process.env.TERMINUS_BROWSER_BASE_URL)
  : "http://127.0.0.1:4176";

if (isReal) {
  requireValue("TERMINUS_BROWSER_PROFILE_MODULE");
  requireCommit("TERMINUS_BROWSER_CANDIDATE_SHA");
}

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["line"]],
  outputDir: "./test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "iphone-13-chromium",
      use: {
        viewport: devices["iPhone 13"].viewport,
        deviceScaleFactor: devices["iPhone 13"].deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: isReal
    ? undefined
    : {
        command: "node test-double/server.mjs",
        url: `${baseURL}/health`,
        reuseExistingServer: false,
        timeout: 10_000,
      },
});

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Real browser mode requires ${name}`);
  }
  return value;
}

function requireSha(name) {
  const value = requireValue(name);
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new Error(`${name} must be a 40-character immutable Git SHA`);
  }
  return value;
}

function requireCommit(name) {
  const value = requireSha(name);
  const result = spawnSync("git", ["cat-file", "-e", `${value}^{commit}`], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${name} does not resolve to a local Git commit object`);
  }
  return value;
}

function requireHttpsUrl(value) {
  if (!value) {
    throw new Error("Real browser mode requires TERMINUS_BROWSER_BASE_URL");
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") {
    throw new Error("TERMINUS_BROWSER_BASE_URL must use HTTPS in real mode");
  }
  return parsed.href.replace(/\/$/, "");
}
