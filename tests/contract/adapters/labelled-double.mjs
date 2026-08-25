export const metadata = Object.freeze({
  label: "Session 06 labelled contract test double",
  evidenceClass: "labelled-test-double",
  targetKind: "test-double",
  candidateSha: null,
});

const outcomes = new Map([
  [
    "labelled-double://opaque-positive",
    { disposition: "accept", reasonClass: "accepted" },
  ],
  [
    "labelled-double://opaque-malformed",
    { disposition: "reject", reasonClass: "malformed" },
  ],
  [
    "labelled-double://opaque-oversized",
    { disposition: "reject", reasonClass: "oversized" },
  ],
  [
    "labelled-double://opaque-unauthenticated",
    { disposition: "reject", reasonClass: "unauthenticated" },
  ],
  [
    "labelled-double://opaque-unauthorized",
    { disposition: "reject", reasonClass: "unauthorized" },
  ],
  [
    "labelled-double://opaque-expired",
    { disposition: "reject", reasonClass: "expired" },
  ],
  [
    "labelled-double://opaque-replayed",
    { disposition: "reject", reasonClass: "replayed" },
  ],
  [
    "labelled-double://opaque-illegal-transition",
    { disposition: "reject", reasonClass: "illegal-transition" },
  ],
  [
    "labelled-double://opaque-unsupported-version",
    { disposition: "reject", reasonClass: "unsupported-version" },
  ],
]);

export async function invoke(testCase) {
  const result = outcomes.get(testCase.stimulusRef);
  if (!result) {
    return { disposition: "reject", reasonClass: "unknown-harness-fixture" };
  }

  return { ...result };
}
