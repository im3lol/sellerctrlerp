import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app-shell/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

// Standalone admin panel — its own shell, no ERP nav, system_admin ONLY. Anyone
// else is bounced to the dedicated admin login (never the tenant workspace), so
// the panel stays fully separated. Middleware enforces the same; this is defence
// in depth in case the panel is reached without passing through it.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (user?.role !== "system_admin") redirect("/login/admin");

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex h-16 items-center gap-2 px-6">
          <Logo className="text-2xl text-sidebar-foreground" />
          <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold">إدارة</span>
        </div>
        <AdminSidebar />
        <div className="mt-auto border-t border-sidebar-border/40 p-4">
          <Link href="/dashboard" className="text-sm text-sidebar-foreground/80 transition-colors hover:text-sidebar-foreground">← الرجوع للنظام</Link>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <span className="font-semibold">لوحة الإدارة</span>
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu name={user.name} email={user.email} role={user.role} title={user.title} avatarUrl={user.avatarUrl} />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
