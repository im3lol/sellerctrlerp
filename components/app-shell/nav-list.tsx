"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { NAV, type NavSection } from "@/components/app-shell/nav-config";
import { can, type Role, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

function visibleItems(section: NavSection, role: Role) {
  return section.items.filter((it) => !it.capability || can(role, it.capability as Capability));
}

export function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();

  // A module is open if it contains the active route. Users can toggle modules
  // open/closed; we seed the open set with whichever module is currently active.
  const initiallyOpen = () => {
    const open: Record<number, boolean> = {};
    NAV.forEach((section, i) => {
      if (section.heading && visibleItems(section, role).some((it) => isActive(pathname, it.href, it.exact))) {
        open[i] = true;
      }
    });
    return open;
  };
  const [openMap, setOpenMap] = useState<Record<number, boolean>>(initiallyOpen);
  const toggle = (i: number) => setOpenMap((m) => ({ ...m, [i]: !m[i] }));

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV.map((section, i) => {
        const items = visibleItems(section, role);
        if (items.length === 0) return null;

        // Top group with no heading (e.g. Dashboard): render items directly.
        if (!section.heading) {
          return (
            <div key={i} className="space-y-1 pb-2">
              {items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} onNavigate={onNavigate} />
              ))}
            </div>
          );
        }

        // Collapsible module group.
        const open = openMap[i] ?? false;
        const groupActive = items.some((it) => isActive(pathname, it.href, it.exact));
        return (
          <div key={i} className="space-y-1">
            <button
              type="button"
              onClick={() => toggle(i)}
              aria-expanded={open}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                groupActive
                  ? "text-sidebar-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              {section.icon && <Icon name={section.icon} className="size-[18px] shrink-0" />}
              <span className="flex-1 text-start">{section.heading}</span>
              <Icon
                name="ChevronDown"
                className={cn("size-4 shrink-0 transition-transform", open ? "rotate-180" : "")}
              />
            </button>
            {open && (
              <div className="space-y-1 border-s border-sidebar-border/40 ms-5 ps-2">
                {items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(pathname, item.href, item.exact)} onNavigate={onNavigate} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavSection["items"][number];
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-sidebar-foreground text-sidebar shadow-sm"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
      )}
    >
      <Icon name={item.icon} className="size-[18px]" />
      <span>{item.label}</span>
    </Link>
  );
}
