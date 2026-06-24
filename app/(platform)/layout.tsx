import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeftRight, LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { signOutAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";

// Standalone platform-owner console — fully isolated from the tenant ERP. No org
// switcher, no module nav; only the system owner (system_admin) may enter.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "system_admin") redirect("/dashboard");

  return (
    <div className="min-h-screen bg-muted/30" dir="rtl">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-foreground text-background">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Logo className="text-2xl text-background" />
            <span className="rounded-full bg-background/15 px-2.5 py-0.5 text-xs font-medium">لوحة إدارة المنصّة</span>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <span className="me-2 hidden text-background/60 sm:inline">{user.name}</span>
            <Link href="/dashboard" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-background/80 transition-colors hover:bg-background/10 hover:text-background">
              <ArrowLeftRight className="size-4" /> النظام
            </Link>
            <form action={signOutAction}>
              <button type="submit" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-background/80 transition-colors hover:bg-background/10 hover:text-background">
                <LogOut className="size-4" /> خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4 md:p-6">{children}</main>
    </div>
  );
}
