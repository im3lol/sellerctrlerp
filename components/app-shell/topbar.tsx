"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { modulesContaining } from "@/lib/active-module";
import { sectionAllowed } from "@/lib/nav-access";
import { Menu } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import { AwesomeBar } from "@/components/app-shell/awesome-bar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { useT } from "@/lib/i18n/client";
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
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  // Same rule as the sidebar, so the phone's menu button appears exactly when there's a
  // module list to put in it.
  const perms = new Set(erpPermissions);
  const inModule = modulesContaining(usePathname(), (s) => sectionAllowed(s, { permissions: perms, modules, navHidden })).length > 0;
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
      {/* Mobile menu */}
      {inModule && <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetTrigger className="grid size-10 place-items-center rounded-lg hover:bg-accent lg:hidden">
          <Menu className="size-5" />
        </SheetTrigger>
        <SheetContent side="right" className="w-72 overflow-y-auto bg-sidebar p-0 text-sidebar-foreground">
          <SheetTitle className="sr-only">{t("القائمة")}</SheetTitle>
          <Link href="/apps" onClick={() => setMenuOpen(false)} className="flex h-16 items-center px-6" aria-label={t("كل التطبيقات")}>
            <Logo className="text-2xl" variant="white" />
          </Link>
          <div className="px-4 pb-3">
            <AwesomeBar erpPermissions={erpPermissions} modules={modules} navHidden={navHidden} className="block" />
          </div>
          {/* Close the drawer when a link/heading navigates. */}
          <NavList role={user.role} erpPermissions={erpPermissions} modules={modules} platforms={platforms} navHidden={navHidden} onNavigate={() => setMenuOpen(false)} />
        </SheetContent>
      </Sheet>}

      {/* Fixed identity mark — deliberately not an app-launcher button. */}
      <div className="hidden shrink-0 select-none border-s border-border/70 ps-3 text-primary sm:block" aria-label="SellerCtrl">
        <Logo className="text-xl" />
      </div>

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
