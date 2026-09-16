import type { Metadata, Viewport } from "next";
import { thmanyah } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  // One host for canonical, OG, robots and the sitemap — the one the app is served on.
  metadataBase: new URL(process.env.APP_URL ?? "https://app.sellerctrl.com"),
  title: {
    default: "SellerCtrl | ERP عربي لبائعي Amazon",
    template: "%s | SellerCtrl",
  },
  description: "نظام ERP عربي موحّد لبائعي Amazon: المحاسبة والمخزون والمبيعات والشراء والتسويات في مكان واحد.",
  keywords: ["ERP", "Amazon", "بائع أمازون", "محاسبة", "مخزون", "SellerCtrl"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "ar_EG",
    url: "/",
    siteName: "SellerCtrl",
    title: "SellerCtrl | ERP عربي لبائعي Amazon",
    description: "المحاسبة والمخزون والمبيعات والشراء والتسويات في نظام واحد.",
    images: [{ url: "/brand/landing-mockup.png", width: 1536, height: 1024, alt: "لوحة SellerCtrl — بيانات توضيحية" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "SellerCtrl | ERP عربي لبائعي Amazon",
    description: "المحاسبة والمخزون والمبيعات والشراء والتسويات في نظام واحد.",
    images: ["/brand/landing-mockup.png"],
  },
  appleWebApp: { capable: true, title: "SellerCtrl", statusBarStyle: "default" },
};

// Mobile/PWA: brand status bar + cover the notch/safe areas in the standalone app.
export const viewport: Viewport = {
  themeColor: "#0A33D1",
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning className={`${thmanyah.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
