"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import type { SettingsGroup } from "@/lib/erp/settings-nav";
import { cn } from "@/lib/utils";

/**
 * The settings shell nav. Desktop: sticky grouped side list. Mobile: one
 * horizontal scrollable chip row (labels only — descriptions live on /settings).
 */
export function SettingsNav({ groups }: { groups: SettingsGroup[] }) {
  const pathname = usePathname();
  const active = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <>
      {/* Mobile: chips */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden">
        <Chip href="/settings" label="الرئيسية" icon="Settings" active={pathname === "/settings"} />
        {groups.flatMap((g) => g.items).map((it) => (
          <Chip key={it.href} href={it.href} label={it.label} icon={it.icon} active={active(it.href)} />
        ))}
      </div>

      {/* Desktop: grouped side nav */}
      <aside className="sticky top-20 hidden w-60 shrink-0 lg:block">
        <Link
          href="/settings"
          className={cn(
            "mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
            pathname === "/settings" ? "bg-primary text-primary-foreground" : "hover:bg-accent",
          )}
        >
          <Icon name="Settings" className="size-4 shrink-0" />الإعدادات
        </Link>
        <nav className="space-y-4">
          {groups.map((g) => (
            <div key={g.heading}>
              <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.heading}</div>
              <div className="space-y-0.5">
                {g.items.map((it) => {
                  const isActive = active(it.href);
                  return (
                    <Link
                      key={it.href}
                      href={it.href}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
                        isActive ? "bg-primary/10 font-medium text-primary" : "text-foreground/80 hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon name={it.icon} className="size-4 shrink-0" />
                      <span className="flex-1 truncate">{it.label}</span>
                      {it.external && <Icon name="ArrowUpLeft" className="size-3 shrink-0 text-muted-foreground" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

function Chip({ href, label, icon, active }: { href: string; label: string; icon: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent",
      )}
    >
      <Icon name={icon} className="size-3.5" />{label}
    </Link>
  );
}
