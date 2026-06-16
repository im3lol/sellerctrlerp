import localFont from "next/font/local";

// ثمانية (Thmanyah Sans) — licensed brand typeface.
// Files live in app/fonts/*.woff2 (extracted from the licensed family).
export const thmanyah = localFont({
  src: [
    { path: "./fonts/thmanyahsans-Light.woff2", weight: "300", style: "normal" },
    { path: "./fonts/thmanyahsans-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/thmanyahsans-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahsans-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/thmanyahsans-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah",
  display: "swap",
  // Arabic + Latin fallback chain while the brand font loads.
  fallback: ["IBM Plex Sans Arabic", "Segoe UI", "Tahoma", "system-ui", "sans-serif"],
});
