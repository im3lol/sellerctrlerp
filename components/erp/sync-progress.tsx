"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, ShoppingCart, Warehouse, Check, X, Loader2, RefreshCw } from "lucide-react";
import { syncProductsAction, productsSyncStatusAction, syncOrdersAction, syncInventoryAction } from "@/app/actions/erp/marketplace-sync";
import { startInventoryAuditAction, inventoryAuditStatusAction } from "@/app/actions/erp/fba-inventory";
import type { ProductSyncStatus } from "@/lib/erp/marketplace/sync-core";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const productsDetail = (s: ProductSyncStatus) =>
  `${s.total ?? 0} منتج · ${s.created ?? 0} جديد · ${s.linked ?? 0} مربوط`;

type Status = "pending" | "running" | "done" | "error";
type Step = { key: string; label: string; icon: React.ReactNode; status: Status; detail: string; href?: string; hrefLabel?: string };
type Flags = { products: boolean; orders: boolean; inventory: boolean };

const initial = (flags: Flags): Step[] => [
  flags.products && { key: "products", label: "المنتجات", icon: <Boxes className="size-4" />, status: "pending" as Status, detail: "" },
  flags.orders && { key: "orders", label: "المبيعات", icon: <ShoppingCart className="size-4" />, status: "pending" as Status, detail: "" },
  flags.inventory && { key: "inventory", label: "المخزون", icon: <Warehouse className="size-4" />, status: "pending" as Status, detail: "" },
].filter(Boolean) as Step[];

export function SyncProgress({ code, label = "المنصة", flags, auditInventory = false, open, onClose }: { code: string; label?: string; flags: Flags; auditInventory?: boolean; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[]>(() => initial(flags));
  const [running, setRunning] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    setRunning(true);
    setSteps(initial(flags));
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const set = (key: string, status: Status, detail = "", href?: string, hrefLabel?: string) =>
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, status, detail, href, hrefLabel } : s)));

  // Run a step and update its row as it resolves. Each source pulls its own
  // Amazon report, so we fire them concurrently — the reports generate in
  // parallel instead of back-to-back (roughly 3× faster wall time).
  async function step<T extends { ok: boolean; error?: string }>(key: string, fn: () => Promise<T>, ok: (r: Extract<T, { ok: true }>) => string) {
    set(key, "running", `جاري السحب من ${label}…`);
    try {
      const r = await fn();
      set(key, r.ok ? "done" : "error", r.ok ? ok(r as Extract<T, { ok: true }>) : (r.error ?? "فشل"));
    } catch {
      set(key, "error", "انقطع الاتصال — التقرير قد يكون كبيرًا ويحتاج وقتًا. جرّب مرة أخرى.");
    }
  }

  // Products run in the BACKGROUND server-side (a full 11k pull takes minutes,
  // longer than the browser holds the request). ATTACH to a job that's already
  // running instead of starting a duplicate. productsSyncStatusAction reads the
  // LATEST sync_runs row regardless of age, so "done"/"error" here just means
  // "nothing in flight right now" — a leftover row from a PAST click, not proof
  // this click's request was ever sent. Only "running" means attach-don't-enqueue;
  // every other phase starts a fresh import. Then poll until done — closing the
  // popup doesn't stop the server job.
  async function runProducts() {
    set("products", "running", "جاري التحقق…");
    const cur = await productsSyncStatusAction(code).catch(() => null);
    if (cur?.phase !== "running") { // done/error/idle/unreachable → start a fresh import
      const s = await syncProductsAction(code);
      if (!s.ok) { set("products", "error", s.error ?? "فشل"); return; }
    }
    for (let i = 0; i < 450; i++) { // ~30 min ceiling at 4s
      set("products", "running", `جاري السحب من ${label}… (السحب الكامل قد يستغرق عدة دقائق)`);
      await sleep(4000);
      let st: ProductSyncStatus;
      try { st = await productsSyncStatusAction(code); } catch { continue; }
      if (st.phase === "done") { set("products", "done", productsDetail(st)); return; }
      if (st.phase === "error") { set("products", "error", st.error ?? "فشل السحب"); return; }
      // running/idle → keep polling
    }
    set("products", "running", "لا تزال المزامنة شغّالة في الخلفية — حدّث الصفحة بعد قليل لرؤية النتيجة.");
  }

  // Inventory for audit-capable platforms (Amazon FBA): run the REAL audit — the one
  // that persists the inventory_audits snapshot the dashboard cards read — instead of
  // the ephemeral compare-toast. Read-only by design: never writes stock; the trader
  // turns the result into an opening balance / DRAFT adjustment from the audit card.
  async function runAudit() {
    set("inventory", "running", `تدقيق مخزون FBA…`);
    const s = await startInventoryAuditAction(code).catch(() => null);
    if (!s?.ok) { set("inventory", "error", s?.error ?? "فشل بدء التدقيق"); return; }
    if (!s.started) { set("inventory", "done", "اكتمل التدقيق — راجع كارت تدقيق المخزون"); return; } // inline fallback already ran
    await sleep(5000); // let the worker write its RUN row so we don't read a stale older audit
    for (let i = 0; i < 150; i++) { // ~10 min ceiling at 4s
      let st; try { st = await inventoryAuditStatusAction(code); } catch { await sleep(4000); continue; }
      if (st.phase === "done") {
        // Answer «الفرق أشوفه منين؟» in place: the diffs live in the reconciliation report.
        set("inventory", "done", `${st.totalSkus ?? 0} صنف · ${st.withDiff ?? 0} فرق`,
          (st.withDiff ?? 0) > 0 ? "/inventory/reconciliation" : undefined, "عرض الفروقات ←");
        return;
      }
      if (st.phase === "error") { set("inventory", "error", st.error ?? "فشل التدقيق"); return; }
      await sleep(4000);
    }
    set("inventory", "running", "التدقيق لا يزال يعمل في الخلفية — حدّث الصفحة لاحقًا.");
  }

  async function run() {
    const jobs: Promise<unknown>[] = [];
    if (flags.products) jobs.push(runProducts());
    if (flags.orders) jobs.push(step("orders", () => syncOrdersAction(code), (r) =>
      `${r.created} أمر · ${r.fulfilled} دورة كاملة${r.cancelled ? ` · ${r.cancelled} ملغى` : ""}${r.skippedPreGoLive ? `\nتم تخطّي ${r.skippedPreGoLive} أمر أقدم من تاريخ البدء` : ""}`));
    if (flags.inventory) jobs.push(auditInventory
      ? runAudit()
      : step("inventory", () => syncInventoryAction(code), (r) => `${r.matched} مطابَق · ${r.withDiff} فرق`));
    await Promise.allSettled(jobs);
    setRunning(false);
    router.refresh(); // one refresh at the end → updates the product-count card
  }

  const close = () => { started.current = false; onClose(); };
  if (!open) return null;

  const done = steps.filter((s) => s.status === "done" || s.status === "error").length;

  return (
    <div className="w-80 rounded-2xl border bg-background p-4 shadow-xl" dir="rtl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <RefreshCw className={`size-4 ${running ? "animate-spin" : ""}`} />مزامنة {label}
        </div>
        {/* Always closable: the full product sync runs server-side and keeps
            going after the popup closes. */}
        <button onClick={close} className="text-muted-foreground hover:text-foreground" aria-label="إغلاق"><X className="size-4" /></button>
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
              {s.href && <Link href={s.href} className="text-xs text-primary hover:underline">{s.hrefLabel ?? "التفاصيل ←"}</Link>}
            </div>
          </li>
        ))}
      </ul>

      {!running && <div className="mt-3 text-center text-xs text-muted-foreground">اكتملت المزامنة — راجع النتائج بالأعلى.</div>}
    </div>
  );
}
