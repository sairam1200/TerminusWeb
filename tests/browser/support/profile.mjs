import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const mode = process.env.TERMINUS_BROWSER_TARGET ?? "labelled-double";
const moduleUrl =
  mode === "labelled-double"
    ? new URL("../test-double/profile.mjs", import.meta.url)
    : pathToFileURL(
        isAbsolute(process.env.TERMINUS_BROWSER_PROFILE_MODULE)
          ? process.env.TERMINUS_BROWSER_PROFILE_MODULE
          : resolve(process.cwd(), process.env.TERMINUS_BROWSER_PROFILE_MODULE),
      );

const profile = await import(moduleUrl.href);
validateProfile(profile);

export const evidence = Object.freeze({ ...profile.metadata });
export const selectors = Object.freeze({ ...profile.selectors });
export const approvedDestination = profile.approvedDestination;
export const rejectedDestination = profile.rejectedDestination;
export const handshakeDestination = profile.handshakeDestination;
export const alternateBrowserUrl = profile.alternateBrowserUrl;
export const induceDisconnect = profile.induceDisconnect;
export const readRecordedEvents = profile.readRecordedEvents;
export const readCandidateSha = profile.readCandidateSha;

function validateProfile(candidate) {
  const expectedClass =
    mode === "real" ? "real-browser" : "labelled-test-double";
  const requiredSelectors = [
    "terminal",
    "status",
    "mobileKeyBar",
    "tabKey",
    "viewportSize",
    "destination",
    "connect",
  ];

  if (candidate.metadata?.evidenceClass !== expectedClass) {
    throw new Error(`Browser profile evidenceClass must be ${expectedClass}`);
  }
  if (mode === "real") {
    const expectedSha =
      process.env.TERMINUS_BROWSER_CANDIDATE_SHA.toLowerCase();
    if (candidate.metadata.candidateSha?.toLowerCase() !== expectedSha) {
      throw new Error(
        "Browser profile candidateSha does not match TERMINUS_BROWSER_CANDIDATE_SHA",
      );
    }
  }
  for (const selector of requiredSelectors) {
    if (typeof candidate.selectors?.[selector] !== "string") {
      throw new Error(`Browser profile is missing selector: ${selector}`);
    }
  }
  for (const value of [
    "approvedDestination",
    "rejectedDestination",
    "handshakeDestination",
    "alternateBrowserUrl",
  ]) {
    if (typeof candidate[value] !== "string") {
      throw new Error(`Browser profile is missing value: ${value}`);
    }
  }
  if (
    typeof candidate.induceDisconnect !== "function" ||
    typeof candidate.readRecordedEvents !== "function" ||
    typeof candidate.readCandidateSha !== "function"
  ) {
    throw new Error(
      "Browser profile must export induceDisconnect(page), readRecordedEvents(page), and readCandidateSha(page)",
    );
  }
}
