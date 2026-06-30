"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, CreditCard, KeyRound, Server, Monitor, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/platform",                  label: "لوحة التحكم",      icon: LayoutDashboard, exact: true },
  { href: "/platform/customers",        label: "إدارة العملاء",    icon: Users },
  { href: "/platform/subscriptions",   label: "الاشتراكات",       icon: CreditCard },
  { href: "/platform/codes",           label: "أكواد التفعيل",    icon: KeyRound },
  { href: "/platform/installations",     label: "تثبيتات On-Prem",  icon: Server },
  { href: "/platform/desktop-licenses", label: "تراخيص Desktop",   icon: Monitor },
  { href: "/platform/settings",         label: "الإعدادات",        icon: Settings },
];

export function PlatformSidebar() {
  const path = usePathname();
  return (
    <aside className="hidden w-56 shrink-0 border-e border-white/10 bg-foreground md:flex md:flex-col" dir="rtl">
      <nav className="flex flex-col gap-0.5 p-3 pt-4">
        {NAV.map((item) => {
          const active = item.exact ? path === item.href : path.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-background/20 text-background"
                  : "text-background/60 hover:bg-background/10 hover:text-background",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
