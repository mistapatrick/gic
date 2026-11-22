import type { NextConfig } from "next";

// Security headers — the "Secure Headers & CSP" and "Clickjacking" items
// from the Application Security & Vibe-Coding Pre-Deployment Checklist.
//
// Content-Security-Policy is deliberately NOT set here: it needs a fresh
// nonce on every single request (so Next's own injected inline scripts can
// be allow-listed without a blanket 'unsafe-inline' on script-src), and
// next.config.ts's headers() can only return static, request-independent
// values. See src/proxy.ts's buildCsp()/newNonce() for the actual CSP,
// which is applied there instead. Everything below IS static and request-
// independent, so it belongs here rather than being recomputed on every
// request in the proxy.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  /* config options here */
  // Cache Components (Next.js 16's new caching model) is left off so the
  // classic, widely-documented route-segment config (`export const dynamic`,
  // `revalidate`, `maxDuration`) works as written across this codebase —
  // the more predictable choice for a small free-tier production app.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
