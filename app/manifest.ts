import type { MetadataRoute } from "next";

/** PWA manifest — makes the app installable and gives the Android (Capacitor)
 *  shell its name/theme/icons. Colors from --brand-blue (#0A33D1). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SellerCtrl",
    short_name: "SellerCtrl",
    description: "نظام إدارة عمليات SellerCtrl — تحكم كامل في عملياتك من مكان واحد",
    start_url: "/dashboard",
    display: "standalone",
    dir: "rtl",
    lang: "ar",
    background_color: "#ffffff",
    theme_color: "#0A33D1",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
