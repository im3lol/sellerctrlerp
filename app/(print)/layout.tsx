import "../globals.css";

export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="bg-white text-black antialiased">{children}</body>
    </html>
  );
}
