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
  serverExternalPackages: ["pg", "bcryptjs", "xlsx", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // The ERP moved off the /erp prefix (sellerctrl.com/inventory, not /erp/inventory).
  // Redirect old links/bookmarks so nothing 404s. /api/erp stays as-is.
  async redirects() {
    return [
      { source: "/erp", destination: "/dashboard", permanent: true },
      // Print/barcode/export views really do live under /erp (app/(print)/erp/**),
      // and redirects run before the filesystem — exclude them or they 308 into a 404.
      { source: "/erp/:path((?!barcodes/|exports/|.*/print$).*)", destination: "/:path", permanent: true },
    ];
  },
  // Half the app links print views without the /erp prefix (/sales/invoices/N/print).
  // Fallback = only when nothing else matched, so the real /erp/** routes are untouched.
  async rewrites() {
    return {
      fallback: [
        { source: "/:path*/print", destination: "/erp/:path*/print" },
        { source: "/barcodes/:path*", destination: "/erp/barcodes/:path*" },
        { source: "/exports/:path*", destination: "/erp/exports/:path*" },
      ],
    };
  },
};

export default nextConfig;
