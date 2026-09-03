import { describe, expect, it } from "vitest";
import nextConfig, {
  buildContentSecurityPolicy,
  contentSecurityPolicy,
} from "./next.config";

describe("web security headers", () => {
  it("restricts connections to self when no private endpoint is configured", async () => {
    expect(contentSecurityPolicy).toContain("connect-src 'self'");
    expect(contentSecurityPolicy).not.toMatch(/\bwss?:/);

    const headers = await nextConfig.headers?.();
    expect(headers?.[0]?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: contentSecurityPolicy,
    });
  });

  it("adds only the exact configured private WSS origin", () => {
    expect(
      buildContentSecurityPolicy("wss://agent.private.invalid/terminal"),
    ).toContain("connect-src 'self' wss://agent.private.invalid");
    expect(() =>
      buildContentSecurityPolicy("ws://agent.private.invalid/terminal"),
    ).toThrow(/credential-free wss/i);
    expect(() =>
      buildContentSecurityPolicy("wss://token@agent.private.invalid/terminal"),
    ).toThrow(/credential-free wss/i);
  });
});
