import type { Metadata, Viewport } from "next";
import { thmanyah } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "SellerCtrl",
  description: "نظام إدارة عمليات SellerCtrl — تحكم كامل في عملياتك من مكان واحد",
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
