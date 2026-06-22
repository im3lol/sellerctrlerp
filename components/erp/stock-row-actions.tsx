"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmStockTransferAction, deleteStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { confirmStockAdjustmentAction, deleteStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { confirm } from "@/components/erp/confirm";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function StockRowActions({
  docId,
  type,
  status,
  canManage,
  dest,
}: {
  docId: string;
  type: "transfer" | "adjustment";
  status: string;
  canManage: boolean;
  dest?: string; // navigate here after a successful action (e.g. from a detail page)
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;
  const isTransfer = type === "transfer";

  const run = (opts: Parameters<typeof confirm>[0], fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      if (!(await confirm(opts))) return;
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  const label = isTransfer ? "التحويل" : "التسوية";

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending}
        onClick={() => run(
          { title: "تأكيد وترحيل", description: `سيتم ترحيل ${label} محاسبياً وتحديث المخزون.`, confirmText: "تأكيد وترحيل" },
          () => isTransfer ? confirmStockTransferAction(docId) : confirmStockAdjustmentAction(docId), "تم التأكيد والترحيل")}>
        <Icon name="Check" className="size-4" />تأكيد
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف"
        onClick={() => run(
          { title: "حذف المسودة", description: `سيتم حذف مسودة ${label} نهائياً.`, confirmText: "حذف", danger: true },
          () => isTransfer ? deleteStockTransferAction(docId) : deleteStockAdjustmentAction(docId), "تم حذف المسودة")}>
        <Icon name="Trash2" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
