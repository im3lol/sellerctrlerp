"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, PackageX, CalendarClock, Clock, FilePlus2, CheckCircle2, FileClock, CheckCheck, ShoppingCart, Undo2, Volume2, VolumeX } from "lucide-react";
import { getNotificationsAction } from "@/app/actions/erp/notifications";
import type { Notifications } from "@/lib/erp/notifications-data";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { playChime, isSoundOn, setSoundOn } from "@/lib/sound";

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
  const [soundOn, setSound] = useState(true);
  const seenRef = useRef<string>("");
  const lastTotalRef = useRef<number | null>(null); // to chime only when the count rises

  const load = () => getNotificationsAction(seenRef.current || undefined).then((data) => {
    setN(data);
    const prev = lastTotalRef.current;
    if (prev !== null && data.total > prev) playChime("notify"); // new notification arrived
    lastTotalRef.current = data.total;
  }).catch(() => {});
  useEffect(() => {
    seenRef.current = localStorage.getItem("notif_seen_at") ?? new Date().toISOString();
    localStorage.setItem("notif_seen_at", seenRef.current);
    setAckTotal(Number(localStorage.getItem("notif_ack_total") ?? -1));
    setSound(isSoundOn());
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // Opening the panel only clears the red badge — it must NOT reset the "since"
  // window, or the new items you opened to read would vanish instantly.
  const acknowledgeBadge = () => { const t = n?.total ?? 0; setAckTotal(t); localStorage.setItem("notif_ack_total", String(t)); load(); };
  // Reset the since-window (clears the "new" rows) — only on explicit mark-all-read.
  const markSeen = () => { const now = new Date().toISOString(); seenRef.current = now; localStorage.setItem("notif_seen_at", now); load(); };
  const markAllRead = () => {
    const t = n?.total ?? 0;
    setAckTotal(t); localStorage.setItem("notif_ack_total", String(t));
    markSeen();
  };

  const total = n?.total ?? 0;
  const showBadge = total > 0 && total > ackTotal;

  const rows = [
    { show: !!n?.newOrders, icon: <ShoppingCart className="size-4" />, tone: "primary", label: "طلبات أمازون جديدة", count: n?.newOrders ?? 0, href: "/sales/orders" },
    { show: !!n?.unmatched, icon: <PackageX className="size-4" />, tone: "red", label: "طلبات بمنتج غير معرَّف", count: n?.unmatched ?? 0, href: "/sales/orders/unmatched" },
    { show: !!n?.unclaimedReturns, icon: <Undo2 className="size-4" />, tone: "amber", label: "مرتجعات منصّات بانتظار المطابقة", count: n?.unclaimedReturns ?? 0, href: "/sales/returns" },
    { show: !!n?.needsReview, icon: <PackageX className="size-4" />, tone: "amber", label: "أصناف من أمازون تحتاج مراجعة", count: n?.needsReview ?? 0, href: "/inventory/items?review=1" },
    { show: !!n?.stockWaiting, icon: <PackageX className="size-4" />, tone: "amber", label: "أذون صرف بانتظار توفّر المخزون", count: n?.stockWaiting ?? 0, href: "/sales/deliveries?status=DRAFT" },
    { show: !!n?.pendingDrafts, icon: <FileClock className="size-4" />, tone: "amber", label: "مسودات بانتظار التأكيد", count: n?.pendingDrafts ?? 0, href: "/drafts" },
    { show: !!n?.newActivity, icon: <FilePlus2 className="size-4" />, tone: "primary", label: "مستندات جديدة", count: n?.newActivity ?? 0, href: "/audit" },
    { show: !!n?.lowStock, icon: <PackageX className="size-4" />, tone: "amber", label: "أصناف تحت حد الطلب", count: n?.lowStock ?? 0, href: "/inventory/reorder" },
    { show: !!n?.expiring, icon: <CalendarClock className="size-4" />, tone: "amber", label: "أصناف قرب/بعد انتهاء الصلاحية", count: n?.expiring ?? 0, href: "/inventory/expiry" },
    { show: !!n?.overdueAR, icon: <Clock className="size-4" />, tone: "red", label: `فواتير بيع متأخرة${n?.overdueTotal ? ` (${int(n.overdueTotal)})` : ""}`, count: n?.overdueAR ?? 0, href: "/accounting/aging" },
    { show: !!n?.overdueAP, icon: <Clock className="size-4" />, tone: "red", label: `فواتير شراء متأخرة${n?.overdueAPTotal ? ` (${int(n.overdueAPTotal)})` : ""}`, count: n?.overdueAP ?? 0, href: "/accounting/aging" },
  ].filter((r) => r.show);

  const toneCls: Record<string, string> = {
    amber: "bg-amber-500/12 text-amber-600",
    primary: "bg-primary/12 text-primary",
    red: "bg-destructive/12 text-destructive",
  };

  return (
    <Popover onOpenChange={(o) => o && acknowledgeBadge()}>
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
            <button
              onClick={() => { const next = !soundOn; setSound(next); setSoundOn(next); }}
              className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent"
              aria-label={soundOn ? "كتم نغمات الإشعارات" : "تشغيل نغمات الإشعارات"}
              title={soundOn ? "النغمات مفعّلة" : "النغمات مكتومة"}
            >
              {soundOn ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
            </button>
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
