import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS app. The parent dir (E:\Dev\Ctrl ERP) has a
  // bun.lock, so Next would otherwise infer the wrong root (multiple lockfiles),
  // which breaks app-directory resolution.
  turbopack: { root: __dirname },
  // Standalone for the Docker runtime; on Vercel let the platform handle output.
  output: process.env.VERCEL ? undefined : "standalone",
  // Keep heavy server-only deps out of the Turbopack bundle — loaded as native
  // node modules at runtime. Big win for cold-compile time in dev.
  serverExternalPackages: ["pg", "googleapis", "@anthropic-ai/sdk", "bcryptjs", "xlsx"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
