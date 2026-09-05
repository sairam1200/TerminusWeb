import { describe, expect, it } from "vitest";
import { parseSessionFragment, sessionFragment } from "./sessionFragment";

describe("remembered session fragments", () => {
  it("accepts only a canonical fragment and keeps the ID out of paths and queries", () => {
    expect(parseSessionFragment("#/s/k7m4-p2q9-wxyz")).toEqual({
      kind: "session",
      sessionId: "k7m4-p2q9-wxyz",
    });
    expect(sessionFragment("rstv-wxyz-2345")).toBe("#/s/rstv-wxyz-2345");
  });

  it.each([
    "#/s/K7M4-P2Q9-WXYZ",
    "#/s/short",
    "#/s/k7m4-p2q9-wxyz/extra",
    "?session=k7m4-p2q9-wxyz",
    "/s/k7m4-p2q9-wxyz",
  ])("fails closed for %s", (hash) => {
    expect(parseSessionFragment(hash)).toEqual({ kind: "invalid" });
  });
});
