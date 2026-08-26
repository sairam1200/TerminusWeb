import type { NextConfig } from "next";
import { privateWssCspSource } from "./protocol/endpointPolicy";

export function buildContentSecurityPolicy(privateEndpoint?: string): string {
  const wssSource = privateWssCspSource(privateEndpoint);
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `connect-src 'self'${wssSource === undefined ? "" : ` ${wssSource}`}`,
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self'",
  ].join("; ");
}

export const contentSecurityPolicy = buildContentSecurityPolicy(
  process.env.NEXT_PUBLIC_TERMINUS_WSS_ENDPOINT,
);

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
