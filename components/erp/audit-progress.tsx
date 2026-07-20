"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardCheck, Check, X, Loader2 } from "lucide-react";
import { inventoryAuditStatusAction } from "@/app/actions/erp/fba-inventory";

type AuditStatus = Awaited<ReturnType<typeof inventoryAuditStatusAction>>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bottom-left progress card for the background Inventory Audit. Polls the latest
 *  INVENTORY sync_run; closing keeps the server job running. */
export function AuditProgress({ code, open, onClose }: { code: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [st, setSt] = useState<AuditStatus>({ phase: "running" });
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setSt({ phase: "running" });
    void (async () => {
      for (let i = 0; i < 300; i++) { // ~20 min ceiling
        await sleep(4000);
        let s: AuditStatus;
        try { s = await inventoryAuditStatusAction(code); } catch { continue; }
        setSt(s);
        if (s.phase === "done" || s.phase === "error") { router.refresh(); return; }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => { started.current = false; onClose(); };
  if (!open) return null;
  const running = st.phase === "running" || st.phase === "idle";

  return (
    <div className="fixed bottom-24 left-4 z-[60] w-80 rounded-2xl border bg-background p-4 shadow-xl" dir="rtl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold"><ClipboardCheck className={`size-4 ${running ? "animate-pulse" : ""}`} />تدقيق المخزون</div>
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
          {running && <span>جاري مطابقة مخزون FBA مع النظام… (قد يستغرق دقائق)</span>}
          {st.phase === "done" && <span className="text-muted-foreground">تم: <b>{st.totalSkus ?? 0}</b> صنف · {st.withDiff ?? 0} فرق. <Link href="/inventory/reconciliation" className="text-primary hover:underline">افتح التقرير</Link></span>}
          {st.phase === "error" && <span className="text-destructive">{st.error ?? "فشل التدقيق"}</span>}
        </div>
      </div>

      <div className="mt-2 text-center text-xs text-muted-foreground">قراءة فقط — لا يغيّر المخزون. تقدر تقفل النافذة.</div>
    </div>
  );
}
