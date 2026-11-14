import type { Metadata, Viewport } from "next";
import { thmanyah } from "./fonts";
import { Providers } from "./providers";
import { marketingUrl } from "@/lib/marketing-url";
import { getLocale, getT } from "@/lib/i18n/server";
import { dirOf } from "@/lib/i18n";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getT();
  return {
    // Crawlable marketing pages live on the apex; application links can still use APP_URL.
    metadataBase: new URL(marketingUrl),
    title: {
      default: t("SellerCtrl | ERP عربي لبائعي Amazon"),
      template: "%s | SellerCtrl",
    },
    description: t("نظام ERP عربي موحّد لبائعي Amazon: المحاسبة والمخزون والمبيعات والشراء والتسويات في مكان واحد."),
    keywords: ["ERP", "Amazon", t("بائع أمازون"), t("محاسبة"), t("مخزون"), "SellerCtrl"],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      locale: locale === "en" ? "en_US" : "ar_EG",
      url: "/",
      siteName: "SellerCtrl",
      title: t("SellerCtrl | ERP عربي لبائعي Amazon"),
      description: t("المحاسبة والمخزون والمبيعات والشراء والتسويات في نظام واحد."),
      images: [{ url: "/brand/landing-mockup.png", width: 1536, height: 1024, alt: t("لوحة SellerCtrl — بيانات توضيحية") }],
    },
    twitter: {
      card: "summary_large_image",
      title: t("SellerCtrl | ERP عربي لبائعي Amazon"),
      description: t("المحاسبة والمخزون والمبيعات والشراء والتسويات في نظام واحد."),
      images: ["/brand/landing-mockup.png"],
    },
    appleWebApp: { capable: true, title: "SellerCtrl", statusBarStyle: "default" },
  };
}

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
