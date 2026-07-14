import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Android shell config. The WebView loads the LIVE web app (server.url), so the
 * app is always "the same app" — any web deploy shows up instantly, no APK
 * rebuild. The httpOnly JWT session cookie persists in the WebView, so login
 * sticks. For local testing point `server.url` at a dev/preview URL instead.
 */
const config: CapacitorConfig = {
  appId: "com.sellerctrl.app",
  appName: "SellerCtrl",
  webDir: "www", // placeholder — real UI comes from server.url
  server: {
    url: "https://sellerctrl.com",
    androidScheme: "https",
  },
};

export default config;
