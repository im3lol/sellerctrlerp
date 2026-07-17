"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "نظرة عامة", href: "/admin", icon: "LayoutDashboard", exact: true },
  { label: "الباقات", href: "/admin/plans", icon: "Package" },
  { label: "المؤسسات والاشتراكات", href: "/admin/licensing", icon: "Building2" },
  { label: "كوبونات الخصم", href: "/admin/coupons", icon: "Ticket" },
  { label: "الأكاديمية", href: "/admin/academy", icon: "GraduationCap" },
  { label: "آخر التحديثات", href: "/admin/changelog", icon: "Sparkles" },
  { label: "الاقتراحات والشكاوى", href: "/admin/feedback", icon: "MessageSquarePlus" },
  { label: "أدوات النظام", href: "/admin/system", icon: "Server" },
];

export function AdminSidebar() {
  const p = usePathname();
  const active = (h: string, exact?: boolean) => (exact ? p === h : p === h || p.startsWith(h + "/"));
  return (
    <nav className="flex flex-col gap-1 px-3 py-4">
      {NAV.map((i) => (
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
