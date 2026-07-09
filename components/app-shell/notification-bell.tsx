"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, PackageX, CalendarClock, Clock } from "lucide-react";
import { getNotificationsAction, type Notifications } from "@/app/actions/erp/notifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export function NotificationBell() {
  const [n, setN] = useState<Notifications | null>(null);

  // ponytail: fetch once on mount for the badge; refetch on open. No polling.
  const load = () => getNotificationsAction().then(setN).catch(() => {});
  useEffect(() => { load(); }, []);

  const total = n?.total ?? 0;
  const rows = [
    { show: !!n?.lowStock, icon: <PackageX className="size-4 text-amber-600" />, label: "أصناف تحت حد الطلب", count: n?.lowStock ?? 0, href: "/erp/inventory/reorder" },
    { show: !!n?.expiring, icon: <CalendarClock className="size-4 text-amber-600" />, label: "أصناف قرب/بعد انتهاء الصلاحية", count: n?.expiring ?? 0, href: "/erp/inventory/expiry" },
    { show: !!n?.overdueAR, icon: <Clock className="size-4 text-destructive" />, label: `فواتير متأخرة السداد${n?.overdueTotal ? ` (${int(n.overdueTotal)})` : ""}`, count: n?.overdueAR ?? 0, href: "/erp/accounting/aging" },
  ].filter((r) => r.show);

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <PopoverTrigger className="relative grid size-10 place-items-center rounded-lg hover:bg-accent" aria-label="الإشعارات">
        <Bell className="size-5" />
        {total > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {total > 99 ? "99+" : int(total)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" dir="rtl">
        <div className="border-b px-4 py-3 text-sm font-semibold">الإشعارات</div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">لا توجد تنبيهات — كل شيء على ما يرام ✅</div>
        ) : (
          <div className="divide-y">
            {rows.map((r) => (
              <Link key={r.href} href={r.href} className={cn("flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent")}>
                {r.icon}
                <span className="flex-1">{r.label}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums">{int(r.count)}</span>
              </Link>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
