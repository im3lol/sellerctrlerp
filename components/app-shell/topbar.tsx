"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { OrgSwitcher } from "@/components/app-shell/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import type { Role } from "@/lib/rbac";

export function Topbar({
  user,
  orgs,
  activeOrgId,
  erpPermissions,
  modules,
  platforms,
}: {
  user: { name: string; email: string; role: Role; title?: string | null; avatarUrl?: string | null };
  orgs: { id: string; nameAr: string }[];
  activeOrgId: string | null;
  erpPermissions: string[];
  modules: string[];
  platforms?: { id: string; name: string; code: string }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    if (query) router.push(`/search?q=${encodeURIComponent(query)}`);
  };
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      {/* Mobile menu */}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger className="grid size-10 place-items-center rounded-lg hover:bg-accent lg:hidden">
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="right" className="w-72 overflow-y-auto bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">القائمة</SheetTitle>
          <div className="flex h-16 items-center px-6">
            <Logo className="text-2xl text-sidebar-foreground" />
          </div>
          {/* Close the drawer when a link/heading navigates. */}
          <NavList role={user.role} erpPermissions={erpPermissions} modules={modules} platforms={platforms} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Search (start / right in RTL) — submits to the results page */}
      <form onSubmit={submitSearch} className="relative hidden w-full max-w-xs md:block" data-tour="topbar-search" role="search">
        <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن صنف أو عميل أو مورّد…" className="bg-muted/50 pr-9" aria-label="بحث" />
      </form>

      {/* Actions (pushed to the end / left in RTL) */}
      <div className="ms-auto flex items-center gap-2">
        <ThemeToggle />
        <div data-tour="notification-bell"><NotificationBell /></div>
        <div data-tour="org-switcher"><OrgSwitcher orgs={orgs} activeId={activeOrgId} /></div>
        <div className="mx-1 hidden h-8 w-px bg-border sm:block" />
        <UserMenu
          name={user.name}
          email={user.email}
          role={user.role}
          title={user.title}
          avatarUrl={user.avatarUrl}
        />
      </div>
    </header>
  );
}
