"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ShoppingCart, Check, X, Loader2 } from "lucide-react";
import { ordersSyncStatusAction } from "@/app/actions/erp/marketplace-sync";

type OrdersStatus = Awaited<ReturnType<typeof ordersSyncStatusAction>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bottom-left progress card for the background sales (orders) sync. Polls the
 *  latest ORDERS sync_run; closing keeps the server job running. */
export function OrdersProgress({ code, label = "المنصة", open, onClose }: { code: string; label?: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [st, setSt] = useState<OrdersStatus>({ phase: "running" });
  const [timedOut, setTimedOut] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setSt({ phase: "running" }); setTimedOut(false);
    void (async () => {
      // A paced backfill (Amazon rate limits) can run ~1s/order → tens of minutes.
      // Poll for up to ~2h; if still running past that, stop polling and tell the
      // user it continues in the background (the job isn't tied to this popup).
      // Poll first, THEN sleep: without Redis the pull runs inline and is already
      // done when this popup opens, so a sleep-first loop would spin a pointless 5s.
      for (let i = 0; i < 1440; i++) {
        let s: OrdersStatus;
        try { s = await ordersSyncStatusAction(code); } catch { await sleep(5000); continue; }
        setSt(s);
        if (s.phase === "done" || s.phase === "error") { router.refresh(); return; }
        await sleep(5000);
      }
      setTimedOut(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { started.current = false; onClose(); };
  if (!open) return null;
  const running = st.phase === "running" || st.phase === "idle";

  return (
    <div className="w-80 rounded-2xl border bg-background p-4 shadow-xl" dir="rtl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><ShoppingCart className={`size-4 ${running ? "animate-pulse" : ""}`} />سحب المبيعات</div>
        <button onClick={close} aria-label="إغلاق" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={`h-full transition-all ${st.phase === "error" ? "bg-destructive" : "bg-emerald-600"} ${running ? "animate-pulse" : ""}`} style={{ width: running ? "66%" : "100%" }} />
      </div>

      <div className="flex items-start gap-2.5 text-sm">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border">
          {running ? <Loader2 className="size-3.5 animate-spin" />
            : st.phase === "done" ? <Check className="size-3.5 text-emerald-600" />
            : <X className="size-3.5 text-destructive" />}
        </span>
        <div className="min-w-0 flex-1">
          {running && !timedOut && <span>جاري سحب الطلبات من {label}… (قد يستغرق دقائق حسب معدّل المنصة)</span>}
          {running && timedOut && <span className="text-muted-foreground">السحب لسه شغّال في الخلفية. <Link href="/sales/orders" className="text-primary hover:underline">افتح الطلبات</Link> لمتابعة الجديد.</span>}
          {st.phase === "done" && <span className="text-muted-foreground">تم سحب <b>{st.created ?? 0}</b> أمر بيع. <Link href="/sales/orders" className="text-primary hover:underline">افتح الطلبات</Link></span>}
          {st.phase === "error" && <span className="text-destructive">{st.error ?? "فشل سحب المبيعات"}</span>}
        </div>
      </div>

      <div className="mt-2 text-center text-xs text-muted-foreground">تقدر تقفل النافذة والسحب يكمل في الخلفية.</div>
    </div>
  );
}
