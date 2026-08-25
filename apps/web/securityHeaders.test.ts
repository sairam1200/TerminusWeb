import { describe, expect, it } from "vitest";
import nextConfig, { contentSecurityPolicy } from "./next.config";

describe("web security headers", () => {
  it("restricts network connections to the same origin for S02-001", async () => {
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
    expect(contentSecurityPolicy).not.toMatch(/\bwss?:/);

    const headers = await nextConfig.headers?.();
    expect(headers?.[0]?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: contentSecurityPolicy,
    });
  });
});
