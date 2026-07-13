"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, ShoppingCart, Warehouse, Check, X, Loader2, RefreshCw } from "lucide-react";
import { syncProductsAction, syncOrdersAction, syncInventoryAction } from "@/app/actions/erp/marketplace-sync";

type Status = "pending" | "running" | "done" | "error";
type Step = { key: string; label: string; icon: React.ReactNode; status: Status; detail: string };

const initial = (): Step[] => [
  { key: "products", label: "المنتجات", icon: <Boxes className="size-4" />, status: "pending", detail: "" },
  { key: "orders", label: "الأوامر", icon: <ShoppingCart className="size-4" />, status: "pending", detail: "" },
  { key: "inventory", label: "المخزون", icon: <Warehouse className="size-4" />, status: "pending", detail: "" },
];

export function SyncProgress({ code, open, onClose }: { code: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(initial);
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setRunning(true);
    setSteps(initial());
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: string, status: Status, detail = "") =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail } : s)));

  // Run a step and update its row as it resolves. Each source pulls its own
  // Amazon report, so we fire them concurrently — the reports generate in
  // parallel instead of back-to-back (roughly 3× faster wall time).
  async function step<T extends { ok: boolean; error?: string }>(key: string, fn: () => Promise<T>, ok: (r: Extract<T, { ok: true }>) => string) {
    set(key, "running");
    try {
      const r = await fn();
      set(key, r.ok ? "done" : "error", r.ok ? ok(r as Extract<T, { ok: true }>) : (r.error ?? "فشل"));
    } catch {
      set(key, "error", "انقطع الاتصال — التقرير قد يكون كبيرًا ويحتاج وقتًا. جرّب مرة أخرى.");
    }
  }

  async function run() {
    await Promise.allSettled([
      step("products", () => syncProductsAction(code), (r) => `${r.created} جديد · ${r.linked} مربوط\n${r.images} صورة · ${r.barcodes} باركود · ${r.families} عائلة`),
      step("orders", () => syncOrdersAction(code), (r) => `${r.created} أمر · ${r.fulfilled} دورة كاملة`),
      step("inventory", () => syncInventoryAction(code), (r) => `${r.matched} مطابَق · ${r.withDiff} فرق`),
    ]);
    setRunning(false);
    router.refresh();
  }

  const close = () => { started.current = false; onClose(); };
  if (!open) return null;

  const done = steps.filter((s) => s.status === "done" || s.status === "error").length;

  return (
    <div className="fixed bottom-24 left-4 z-[60] w-80 rounded-2xl border bg-background p-4 shadow-xl" dir="rtl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <RefreshCw className={`size-4 ${running ? "animate-spin" : ""}`} />مزامنة أمازون
        </div>
        {!running && <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="إغلاق"><X className="size-4" /></button>}
      </div>

      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>

      <ul className="space-y-2.5">
        {steps.map((s) => (
          <li key={s.key} className="flex items-start gap-2.5 text-sm">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border">
              {s.status === "running" ? <Loader2 className="size-3.5 animate-spin" />
                : s.status === "done" ? <Check className="size-3.5 text-emerald-600" />
                : s.status === "error" ? <X className="size-3.5 text-destructive" />
                : s.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">{s.label}</div>
              {s.detail && <div className={`whitespace-pre-line text-xs ${s.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>{s.detail}</div>}
            </div>
          </li>
        ))}
      </ul>

      {!running && <div className="mt-3 text-center text-xs text-muted-foreground">اكتملت المزامنة — راجع النتائج بالأعلى.</div>}
    </div>
  );
}
