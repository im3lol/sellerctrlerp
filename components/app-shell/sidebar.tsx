import { Logo } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import type { Role } from "@/lib/rbac";

export function Sidebar({ role, modules }: { role: Role; modules: string[] }) {
  return (
    <aside className="hidden w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 items-center gap-2 px-6">
        <Logo className="text-2xl text-sidebar-foreground" />
      </div>
      <NavList role={role} modules={modules} />
      <div className="border-t border-sidebar-border/40 p-4 text-xs text-sidebar-foreground/50">
        SellerCtrl Workspace OS · v1.0
      </div>
    </aside>
  );
}
