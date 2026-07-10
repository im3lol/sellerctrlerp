"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, PackageX, CalendarClock, Clock, FilePlus2, CheckCircle2, FileClock, CheckCheck } from "lucide-react";
import { getNotificationsAction } from "@/app/actions/erp/notifications";
import type { Notifications } from "@/lib/erp/notifications-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
  // Attention counter, not per-message read state: "mark all as read" acknowledges
  // the current total; the badge reappears only when something new pushes it higher.
  const [ackTotal, setAckTotal] = useState<number>(-1);
  const seenRef = useRef<string>("");

  const load = () => getNotificationsAction(seenRef.current || undefined).then(setN).catch(() => {});
  useEffect(() => {
    seenRef.current = localStorage.getItem("notif_seen_at") ?? new Date().toISOString();
    localStorage.setItem("notif_seen_at", seenRef.current);
    setAckTotal(Number(localStorage.getItem("notif_ack_total") ?? -1));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const markSeen = () => { const now = new Date().toISOString(); seenRef.current = now; localStorage.setItem("notif_seen_at", now); load(); };
  const markAllRead = () => {
    const t = n?.total ?? 0;
    setAckTotal(t); localStorage.setItem("notif_ack_total", String(t));
    markSeen();
  };

  const total = n?.total ?? 0;
  const showBadge = total > 0 && total > ackTotal;

  const rows = [
    { show: !!n?.pendingDrafts, icon: <FileClock className="size-4" />, tone: "amber", label: "مسودات بانتظار التأكيد", count: n?.pendingDrafts ?? 0, href: "/erp/drafts" },
    { show: !!n?.newActivity, icon: <FilePlus2 className="size-4" />, tone: "primary", label: "مستندات جديدة", count: n?.newActivity ?? 0, href: "/erp/audit" },
    { show: !!n?.lowStock, icon: <PackageX className="size-4" />, tone: "amber", label: "أصناف تحت حد الطلب", count: n?.lowStock ?? 0, href: "/erp/inventory/reorder" },
    { show: !!n?.expiring, icon: <CalendarClock className="size-4" />, tone: "amber", label: "أصناف قرب/بعد انتهاء الصلاحية", count: n?.expiring ?? 0, href: "/erp/inventory/expiry" },
    { show: !!n?.overdueAR, icon: <Clock className="size-4" />, tone: "red", label: `فواتير بيع متأخرة${n?.overdueTotal ? ` (${int(n.overdueTotal)})` : ""}`, count: n?.overdueAR ?? 0, href: "/erp/accounting/aging" },
    { show: !!n?.overdueAP, icon: <Clock className="size-4" />, tone: "red", label: `فواتير شراء متأخرة${n?.overdueAPTotal ? ` (${int(n.overdueAPTotal)})` : ""}`, count: n?.overdueAP ?? 0, href: "/erp/accounting/aging" },
  ].filter((r) => r.show);

  const toneCls: Record<string, string> = {
    amber: "bg-amber-500/12 text-amber-600",
    primary: "bg-primary/12 text-primary",
    red: "bg-destructive/12 text-destructive",
  };

  return (
    <Popover onOpenChange={(o) => o && markSeen()}>
      <PopoverTrigger className="relative grid size-10 place-items-center rounded-lg hover:bg-accent" aria-label="الإشعارات">
        <Bell className="size-5" />
        {showBadge && (
          <span className="absolute right-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-4 text-destructive-foreground">
            {total > 99 ? "99+" : int(total)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[75vh] w-[22rem] overflow-y-auto p-0" dir="rtl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">الإشعارات</span>
            {total > 0 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{int(total)}</span>}
          </div>
          {total > 0 && (
            <button onClick={markAllRead} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10">
              <CheckCheck className="size-3.5" /> تحديد الكل كمقروء
            </button>
          )}
        </div>

        {rows.length === 0 && !n?.recent.length ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="size-8 text-emerald-500/70" />
            لا توجد إشعارات
          </div>
        ) : (
          <>
            {rows.length > 0 && (
              <div className="p-2">
                {rows.map((r) => (
                  <Link key={r.href} href={r.href} className="flex items-center gap-3 rounded-lg px-2.5 py-2.5 text-sm transition-colors hover:bg-accent">
                    <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${toneCls[r.tone]}`}>{r.icon}</span>
                    <span className="flex-1 leading-tight">{r.label}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-bold tabular-nums">{int(r.count)}</span>
                  </Link>
                ))}
              </div>
            )}
            {!!n?.recent.length && (
              <>
                <div className="border-y bg-muted/30 px-4 py-1.5 text-xs font-semibold text-muted-foreground">النشاط الأخير</div>
                <div className="p-2">
                  {n.recent.map((a, i) => {
                    const inner = (
                      <>
                        <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${a.action === "CREATE" ? "bg-primary/12 text-primary" : "bg-emerald-500/12 text-emerald-600"}`}>
                          {a.action === "CREATE" ? <FilePlus2 className="size-4" /> : <CheckCircle2 className="size-4" />}
                        </span>
                        <span className="flex-1 truncate leading-tight">{a.summary ?? a.number ?? "مستند"}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{ago(a.at)}</span>
                      </>
                    );
                    return a.href
                      ? <Link key={i} href={a.href} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-accent">{inner}</Link>
                      : <div key={i} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm">{inner}</div>;
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
