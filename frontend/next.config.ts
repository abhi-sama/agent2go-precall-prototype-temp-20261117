import type { NextConfig } from "next";

/**
 * Local builds only: the browser reaches the floci emulator (Cognito, AppSync) through this
 * same-origin prefix because floci answers no CORS preflights. Deployed builds call AWS directly.
 */
const FLOCI_ENDPOINT = process.env.A2G_FLOCI_ENDPOINT ?? "http://localhost:4566"
const flociRewrites =
  process.env.NEXT_PUBLIC_APP_ENV === "local"
    ? [
        { source: "/_floci", destination: `${FLOCI_ENDPOINT}/` },
        { source: "/_floci/:path*", destination: `${FLOCI_ENDPOINT}/:path*` },
      ]
    : []

const nextConfig: NextConfig = {
  // Lets scripts/check-local-only.mjs build a deployed-style bundle without touching .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Pages are client-rendered against the data adapter; no server data fetching in the shell.
  reactStrictMode: true,
  async rewrites() {
    return flociRewrites
  },
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
      ],
    }]
  },
  transpilePackages: ["three"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
