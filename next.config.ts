import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to THIS app. The parent dir (E:\Dev\Ctrl ERP) has a
  // bun.lock, so Next would otherwise infer the wrong root (multiple lockfiles),
  // which breaks app-directory resolution.
  turbopack: { root: __dirname },
  // Standalone: the Docker image ships this bundle. Self-hosted is the only target.
  output: "standalone",
  // Keep heavy server-only deps out of the Turbopack bundle — loaded as native
  // node modules at runtime. Big win for cold-compile time in dev.
  serverExternalPackages: ["pg", "bcryptjs", "xlsx", "bullmq", "ioredis"],
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  // Long-lived immutable cache for content-hashed build assets. A managed platform sets
  // this automatically; a self-hosted Node server does not, so without it every chunk
  // re-downloads on each load. /_next/static filenames
  // carry a content hash → safe to cache forever. This is the whole CDN win here;
  // remote item/logo images are already behind their own CDNs (Amazon media, the
  // object store), so next/image server-side re-encoding would only add VPS load.
  // ponytail: headers() only. Skipped next/image — no sharp, and it'd re-optimize
  // already-CDN'd remote images per request. Add if we ever self-host uncached images.
  async headers() {
    return [
      { source: "/_next/static/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
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
