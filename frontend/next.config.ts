import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages are client-rendered against the data adapter; no server data fetching in the shell.
  reactStrictMode: true,
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
