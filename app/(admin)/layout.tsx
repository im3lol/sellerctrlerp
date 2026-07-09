import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { Logo } from "@/components/brand/logo";
import { UserMenu } from "@/components/app-shell/user-menu";

// Standalone admin panel — its own shell, no ERP nav. System admins only.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.role !== "system_admin") redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="flex h-16 items-center gap-4 border-b bg-sidebar px-6 text-sidebar-foreground">
        <Logo className="text-2xl text-sidebar-foreground" />
        <span className="rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold">لوحة الإدارة</span>
        <nav className="ms-4 flex gap-1 text-sm">
          <Link href="/admin" className="rounded-lg px-3 py-2 transition-colors hover:bg-white/10">الرئيسية</Link>
          <Link href="/admin/users" className="rounded-lg px-3 py-2 transition-colors hover:bg-white/10">المستخدمون</Link>
          <Link href="/admin/licensing" className="rounded-lg px-3 py-2 transition-colors hover:bg-white/10">التراخيص</Link>
        </nav>
        <div className="ms-auto flex items-center gap-3">
          <Link href="/dashboard" className="text-sm text-sidebar-foreground/80 hover:text-sidebar-foreground hover:underline">← الرجوع للنظام</Link>
          <UserMenu name={user.name} email={user.email} role={user.role} title={user.title} avatarUrl={user.avatarUrl} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-6">{children}</main>
    </div>
  );
}
