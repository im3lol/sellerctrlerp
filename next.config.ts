import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone build for the Docker runtime (a long-lived Node server is
  // required by SSE + Postgres LISTEN/NOTIFY realtime).
  output: "standalone",
  // Keep heavy server-only deps out of the Turbopack bundle — loaded as native
  // node modules at runtime. Big win for cold-compile time in dev.
  serverExternalPackages: ["pg", "googleapis", "@anthropic-ai/sdk", "bcryptjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
