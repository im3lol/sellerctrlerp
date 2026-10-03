"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { modulesContaining } from "@/lib/active-module";
import { sectionAllowed } from "@/lib/nav-access";
import { Logo, LogoMark } from "@/components/brand/logo";
import { NavList } from "@/components/app-shell/nav-list";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import type { Role } from "@/lib/rbac";

/** Remembered in a cookie, not localStorage: the server renders the rail at the right
 *  width on the first paint, so a collapsed sidebar never flashes open on every page. */
export const NAV_COLLAPSED_COOKIE = "nav_collapsed";

export function Sidebar({ role, erpPermissions, modules, platforms, navHidden, defaultCollapsed }: { role: Role; erpPermissions: string[]; modules: string[]; platforms?: { id: string; name: string; code: string }[]; navHidden?: string[]; defaultCollapsed?: boolean }) {
  // sticky + h-screen so the nav's own overflow-y-auto can actually engage. With no height
  // the aside just grows to fit its items, so a long nav made the WHOLE page taller than
  // the viewport — you had to scroll the page to reach the bottom of the menu, and it got
  // worse the more the browser was zoomed in (zoom shortens the viewport in CSS pixels).
  // No module, no sidebar: the launcher is the whole screen, and a page that belongs to
  // no module (the dashboard, your profile) has no list of siblings to show.
  // Only modules this member can actually see count — otherwise a hidden or unsubscribed
  // module claims the page and the rail renders empty.
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(!!defaultCollapsed);
  const perms = new Set(erpPermissions);
  if (modulesContaining(pathname, (s) => sectionAllowed(s, { permissions: perms, modules, navHidden })).length === 0) return null;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { document.cookie = `${NAV_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`; } catch { /* cookies blocked — it just forgets */ }
  };

  return (
    <aside className={cn("sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] lg:flex", collapsed ? "w-[72px]" : "w-64")}>
      {/* The logo goes home, and home is the app grid — the one screen that shows the
          whole system at once. Every system in this class does the same. */}
      <div className={cn("flex items-center", collapsed ? "flex-col gap-1 px-2 py-3" : "h-16 gap-2 px-6")}>
        <Link href="/apps" className="flex items-center" aria-label="التطبيقات">
          {collapsed ? <LogoMark className="text-2xl" variant="white" /> : <Logo className="text-2xl" variant="white" />}
        </Link>
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "توسيع القائمة" : "تصغير القائمة"}
          aria-expanded={!collapsed}
          title={collapsed ? "توسيع القائمة" : "تصغير القائمة — أيقونات بس"}
          className={cn(
            "rounded-lg p-1.5 text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
            collapsed ? "" : "ms-auto",
          )}
        >
          <Icon name={collapsed ? "PanelRightOpen" : "PanelRightClose"} className="size-[18px]" />
        </button>
      </div>
      <NavList role={role} erpPermissions={erpPermissions} modules={modules} platforms={platforms} navHidden={navHidden} collapsed={collapsed} />
      {!collapsed && (
        <div className="border-t border-sidebar-border/40 p-4 text-xs text-sidebar-foreground/50">
          SellerCtrl · v1.0
        </div>
      )}
    </aside>
  );
}
