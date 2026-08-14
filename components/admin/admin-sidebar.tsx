"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";
import { ADMIN_NAV } from "@/components/admin/admin-nav";

export function AdminSidebar() {
  const p = usePathname();
  const active = (h: string, exact?: boolean) => (exact ? p === h : p === h || p.startsWith(h + "/"));
  // min-h-0 + overflow-y-auto: the aside is h-screen, so the nav has to scroll itself
  // rather than push the footer link off the bottom on a short/zoomed-in viewport.
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 py-4">
      {ADMIN_NAV.map((i) => (
        <Link key={i.href} href={i.href} className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          active(i.href, i.exact) ? "bg-sidebar-foreground text-sidebar shadow-sm" : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
        )}>
          <Icon name={i.icon} className="size-[18px]" />{i.label}
        </Link>
      ))}
    </nav>
  );
}
