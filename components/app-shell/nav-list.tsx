"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { NAV } from "@/components/app-shell/nav-config";
import { can, type Role, type Capability } from "@/lib/rbac";
import { cn } from "@/lib/utils";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(href + "/");
}

export function NavList({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-4">
      {NAV.map((section, i) => {
        const items = section.items.filter(
          (it) => !it.capability || can(role, it.capability as Capability),
        );
        if (items.length === 0) return null;
        return (
          <div key={i} className="space-y-1">
            {section.heading && (
              <p className="px-3 pb-1 text-xs font-medium text-sidebar-foreground/50">
                {section.heading}
              </p>
            )}
            {items.map((item) => {
              const active = isActive(pathname, item.href, item.exact);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    active
                      ? "bg-sidebar-foreground text-sidebar shadow-sm"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <Icon name={item.icon} className="size-[18px]" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
