import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./.github/**/*",
      "./data/**/*",
      "./docs/**/*",
      "./eval/**/*",
      "./public/**/*",
      "./scripts/**/*",
      "./SPEC_PLAN/**/*",
      "./src/**/*",
      "./tests/**/*",
      "./*.md",
      "./*.mjs",
      "./*.ts",
      "./*.tsbuildinfo",
      "./.dockerignore",
      "./Dockerfile",
      "./docker-compose*.yml",
      "./package-lock.json",
    ],
  },
  async rewrites() {
    return [{ source: "/health", destination: "/api/health" }];
  },
};

export default nextConfig;
