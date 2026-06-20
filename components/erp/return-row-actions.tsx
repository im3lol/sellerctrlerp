"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmSalesReturnAction, deleteSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { confirmPurchaseReturnAction, deletePurchaseReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ReturnRowActions({
  returnId,
  type,
  status,
  canManage,
}: {
  returnId: string;
  type: "sales" | "purchase";
  status: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;
  const isSales = type === "sales";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending}
        onClick={() => run(() => isSales ? confirmSalesReturnAction(returnId) : confirmPurchaseReturnAction(returnId), "تم تأكيد المرتجع وترحيله")}>
        <Icon name="Check" className="size-4" />تأكيد
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف"
        onClick={() => run(() => isSales ? deleteSalesReturnAction(returnId) : deletePurchaseReturnAction(returnId), "تم حذف المسودة")}>
        <Icon name="Trash2" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
