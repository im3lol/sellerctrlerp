"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmStockTransferAction, deleteStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { confirmStockAdjustmentAction, deleteStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function StockRowActions({
  docId,
  type,
  status,
  canManage,
}: {
  docId: string;
  type: "transfer" | "adjustment";
  status: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;
  const isTransfer = type === "transfer";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending}
        onClick={() => run(() => isTransfer ? confirmStockTransferAction(docId) : confirmStockAdjustmentAction(docId), "تم التأكيد والترحيل")}>
        <Icon name="Check" className="size-4" />تأكيد
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف"
        onClick={() => run(() => isTransfer ? deleteStockTransferAction(docId) : deleteStockAdjustmentAction(docId), "تم حذف المسودة")}>
        <Icon name="Trash2" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
