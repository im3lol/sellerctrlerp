"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmSalesReturnAction, deleteSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { selectCls } from "@/lib/utils";

/**
 * DRAFT sales-return confirm with an operator disposition choice. The stored (marketplace)
 * disposition is the default; the operator can override at confirm. Unsellable goods either
 * go to a chosen damaged warehouse (segregated, kept on the books) or are written off (5301
 * loss, no restock) — never silently restocked as sellable.
 */
export function SalesReturnConfirm({ id, defaultDisposition, warehouses, dest }: {
  id: string; defaultDisposition: string | null; warehouses: { id: string; name: string }[]; dest: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  // "SELLABLE" | "DAMAGED". Anything stored that isn't SELLABLE starts as damaged.
  const [cond, setCond] = useState<"SELLABLE" | "DAMAGED">(defaultDisposition && defaultDisposition !== "SELLABLE" ? "DAMAGED" : "SELLABLE");
  const [dest2, setDest2] = useState<string>(""); // "" = write-off; else a warehouse id

  const doConfirm = () => start(async () => {
    const r = await confirmSalesReturnAction(id, {
      disposition: cond === "SELLABLE" ? "SELLABLE" : "DAMAGED",
      damagedWarehouseId: cond === "DAMAGED" && dest2 ? dest2 : null,
    });
    if (r.ok) { toast.success("تم تأكيد المرتجع وترحيله"); router.push(dest); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الترحيل");
  });

  const doDelete = () => void (async () => {
    if (!(await confirm({ danger: true }))) return;
    start(async () => {
      const r = await deleteSalesReturnAction(id);
      if (r.ok) { toast.success("تم حذف المرتجع"); router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحذف");
    });
  })();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={cond} onChange={(e) => setCond(e.target.value as "SELLABLE" | "DAMAGED")} className={`${selectCls} h-9 w-40`} aria-label="حالة البضاعة المرتجعة">
        <option value="SELLABLE">قابل للبيع</option>
        <option value="DAMAGED">تالف / غير قابل للبيع</option>
      </select>
      {cond === "DAMAGED" && (
        <select value={dest2} onChange={(e) => setDest2(e.target.value)} className={`${selectCls} h-9 w-44`} aria-label="وجهة البضاعة التالفة">
          <option value="">شطب (خسارة)</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>مخزن: {w.name}</option>)}
        </select>
      )}
      <Button size="sm" disabled={pending} onClick={doConfirm}><Icon name="Check" className="size-4" />تأكيد المرتجع</Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={doDelete}><Icon name="Trash2" className="size-4 text-destructive" />حذف</Button>
    </div>
  );
}
