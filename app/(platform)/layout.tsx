import Link from "next/link";
import { ArrowLeftRight, LogOut } from "lucide-react";
import { getCurrentUser } from "@/lib/session";
import { signOutAction } from "@/app/actions/auth";
import { Logo } from "@/components/brand/logo";
import { PlatformSidebar } from "@/components/platform/platform-sidebar";

// Standalone platform-owner console — fully isolated from the tenant ERP shell.
// For non-owners (incl. /platform/login) renders bare; each page gates itself.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") return <>{children}</>;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30" dir="rtl">
      {/* Top header */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-foreground text-background">
        <div className="flex h-16 items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Logo className="text-2xl text-background" />
            <span className="rounded-full bg-background/15 px-2.5 py-0.5 text-xs font-medium">
              لوحة إدارة المنصّة
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm">
            <span className="me-2 hidden text-background/60 sm:inline">{user.name}</span>
            <Link
              href="/dashboard"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-background/80 transition-colors hover:bg-background/10 hover:text-background"
            >
              <ArrowLeftRight className="size-4" /> النظام
            </Link>
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-background/80 transition-colors hover:bg-background/10 hover:text-background"
              >
                <LogOut className="size-4" /> خروج
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* Body: sidebar + page content */}
      <div className="flex flex-1">
        <PlatformSidebar />
        <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
