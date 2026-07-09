"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, PackageX, CalendarClock, Clock, FilePlus2, CheckCircle2, FileClock } from "lucide-react";
import { getNotificationsAction } from "@/app/actions/erp/notifications";
import type { Notifications } from "@/lib/erp/notifications-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const rtf = new Intl.RelativeTimeFormat("ar-EG", { numeric: "auto" });
function ago(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "الآن";
  const m = Math.round(s / 60); if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60); if (h < 24) return rtf.format(-h, "hour");
  return rtf.format(-Math.round(h / 24), "day");
}

export function NotificationBell() {
  const [n, setN] = useState<Notifications | null>(null);
  const seenRef = useRef<string>("");

  // ponytail: "seen" marker in localStorage (no per-user DB); the badge counts
  // documents created since it. Poll every 60s so it lights up without a reload —
  // swap for SSE/websocket if a minute's latency ever matters.
  const load = () => getNotificationsAction(seenRef.current || undefined).then(setN).catch(() => {});
  useEffect(() => {
    seenRef.current = localStorage.getItem("notif_seen_at") ?? new Date().toISOString();
    localStorage.setItem("notif_seen_at", seenRef.current);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const markSeen = () => { const now = new Date().toISOString(); seenRef.current = now; localStorage.setItem("notif_seen_at", now); load(); };

  const total = n?.total ?? 0;
  const rows = [
    { show: !!n?.pendingDrafts, icon: <FileClock className="size-4 text-amber-600" />, label: "مسودات بانتظار التأكيد", count: n?.pendingDrafts ?? 0, href: "/erp/drafts" },
    { show: !!n?.newActivity, icon: <FilePlus2 className="size-4 text-primary" />, label: "مستندات جديدة", count: n?.newActivity ?? 0, href: "/erp/audit" },
    { show: !!n?.lowStock, icon: <PackageX className="size-4 text-amber-600" />, label: "أصناف تحت حد الطلب", count: n?.lowStock ?? 0, href: "/erp/inventory/reorder" },
    { show: !!n?.expiring, icon: <CalendarClock className="size-4 text-amber-600" />, label: "أصناف قرب/بعد انتهاء الصلاحية", count: n?.expiring ?? 0, href: "/erp/inventory/expiry" },
    { show: !!n?.overdueAR, icon: <Clock className="size-4 text-destructive" />, label: `فواتير بيع متأخرة${n?.overdueTotal ? ` (${int(n.overdueTotal)})` : ""}`, count: n?.overdueAR ?? 0, href: "/erp/accounting/aging" },
    { show: !!n?.overdueAP, icon: <Clock className="size-4 text-destructive" />, label: `فواتير شراء متأخرة${n?.overdueAPTotal ? ` (${int(n.overdueAPTotal)})` : ""}`, count: n?.overdueAP ?? 0, href: "/erp/accounting/aging" },
  ].filter((r) => r.show);

  return (
    <Popover onOpenChange={(o) => o && markSeen()}>
      <PopoverTrigger className="relative grid size-10 place-items-center rounded-lg hover:bg-accent" aria-label="الإشعارات">
        <Bell className="size-5" />
        {total > 0 && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {total > 99 ? "99+" : int(total)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto p-0" dir="rtl">
        <div className="border-b px-4 py-3 text-sm font-semibold">الإشعارات</div>
        {rows.length === 0 && !n?.recent.length ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">لا توجد إشعارات ✅</div>
        ) : (
          <>
            {rows.length > 0 && (
              <div className="divide-y">
                {rows.map((r) => (
                  <Link key={r.href} href={r.href} className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent">
                    {r.icon}
                    <span className="flex-1">{r.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums">{int(r.count)}</span>
                  </Link>
                ))}
              </div>
            )}
            {!!n?.recent.length && (
              <>
                <div className="border-y bg-muted/30 px-4 py-1.5 text-xs font-semibold text-muted-foreground">النشاط الأخير</div>
                <div className="divide-y">
                  {n.recent.map((a, i) => {
                    const inner = (
                      <>
                        {a.action === "CREATE" ? <FilePlus2 className="size-4 shrink-0 text-primary" /> : <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />}
                        <span className="flex-1 truncate">{a.summary ?? a.number ?? "مستند"}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{ago(a.at)}</span>
                      </>
                    );
                    return a.href
                      ? <Link key={i} href={a.href} className="flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors hover:bg-accent">{inner}</Link>
                      : <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 text-sm">{inner}</div>;
                  })}
                </div>
              </>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
