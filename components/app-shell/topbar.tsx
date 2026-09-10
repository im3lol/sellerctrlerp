"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import { AwesomeBar } from "@/components/app-shell/awesome-bar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import { OrgSwitcher } from "@/components/app-shell/org-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Role } from "@/lib/rbac";

export function Topbar({
  user,
  orgs,
  activeOrgId,
  erpPermissions,
  modules,
  navHidden,
  platforms,
}: {
  user: { name: string; email: string; role: Role; title?: string | null; avatarUrl?: string | null };
  orgs: { id: string; nameAr: string }[];
  activeOrgId: string | null;
  erpPermissions: string[];
  modules: string[];
  navHidden?: string[];
  platforms?: { id: string; name: string; code: string }[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
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
          <NavList role={user.role} erpPermissions={erpPermissions} modules={modules} platforms={platforms} navHidden={navHidden} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* One box for pages AND records — see AwesomeBar for why there is only one. */}
      <AwesomeBar erpPermissions={erpPermissions} modules={modules} navHidden={navHidden} />

      {/* Actions (pushed to the end / left in RTL). min-w-0 so the cluster can shrink:
          the column clips its overflow, so anything that doesn't fit is cut off the edge
          rather than wrapping — which is what happened at heavy browser zoom. */}
      <div className="ms-auto flex min-w-0 items-center gap-2">
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
