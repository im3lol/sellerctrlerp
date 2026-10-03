import type { Metadata, Viewport } from "next";
import { thmanyah } from "./fonts";
import { Providers } from "./providers";
import { marketingUrl } from "@/lib/marketing-url";
import { getLocale } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  // Crawlable marketing pages live on the apex; application links can still use APP_URL.
  metadataBase: new URL(marketingUrl),
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The document's language and direction come from the signed-in person's choice, so an
  // English user gets a left-to-right app without a second set of layouts.
  const locale = await getLocale();
  return (
    <html lang={locale} dir={dirOf(locale)} suppressHydrationWarning className={`${thmanyah.variable} h-full antialiased`}>
      <body className="min-h-full bg-background text-foreground font-sans">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
