"use client";

import Link from "next/link";
import { Icon } from "@/components/icon";
import { NAV } from "@/components/app-shell/nav-config";
import { erpAllows } from "@/lib/nav-access";
import { cn } from "@/lib/utils";

/**
 * Every module the member can open, as one grid of tiles.
 *
 * The sidebar is a hundred and ten links and it is the only map of the system. That is
 * fine when you know where you are going and hopeless when you don't — which is the
 * complaint. Odoo and Frappe both answer it the same way: one screen, one tile per
 * app, and you always start there. It replaces nothing; it is a second way in.
 *
 * Derived from NAV, so a module added tomorrow appears here without anyone remembering
 * a second list — the same reason ModuleWorkspace reads it.
 */

export function AppLauncher({
  erpPermissions,
  modules,
  navHidden,
  onNavigate,
}: {
  erpPermissions: string[];
  modules?: string[];
  navHidden?: string[];
  onNavigate?: () => void;
}) {
  const perms = new Set(erpPermissions);
  const hidden = new Set(navHidden ?? []);

  const tiles: { label: string; href: string; icon: string; color: string; pages: number }[] = [];
  for (const section of NAV) {
    if (section.moduleKey && modules && !modules.includes(section.moduleKey)) continue;
    const items = section.items.filter((i) => erpAllows(i, perms));

    // The heading-less top section is the dashboard: one page, not a module, but the
    // owner wants it one click from home, so it is the first tile and the only non-module.
    if (!section.heading) {
      for (const i of items) tiles.push({ label: i.label, href: i.href, icon: i.icon, color: "bg-blue-600", pages: 0 });
      continue;
    }
    if (hidden.has(section.heading)) continue;

    // A module with a landing page stays visible even with no items the member may
    // open — المنصات before any platform is connected is the case that matters.
    const href = section.href ?? items[0]?.href;
    if (!href || (items.length === 0 && !section.href)) continue;

    tiles.push({
      label: section.heading,
      href,
      icon: section.icon ?? "Square",
      color: section.color ?? "bg-zinc-500",
      pages: items.length,
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
      {tiles.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          onClick={onNavigate}
          className="group flex flex-col items-center gap-2 rounded-2xl border border-transparent p-3 text-center transition-colors hover:border-border hover:bg-muted/50"
        >
          <span className={cn(
            "flex items-center justify-center rounded-2xl text-white shadow-sm transition-transform group-hover:scale-105",
            t.color,
            "size-14",
          )}>
            <Icon name={t.icon} className="size-7" />
          </span>
          <span className="min-w-0 text-sm font-medium leading-tight">{t.label}</span>
          {t.pages > 0 && (
            <span className="text-xs text-muted-foreground">
              {t.pages.toLocaleString("ar-EG-u-nu-latn")} صفحة
            </span>
          )}
        </Link>
      ))}
    </div>
  );
}
