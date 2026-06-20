"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptVoucherAction, deleteReceiptVoucherAction } from "@/app/actions/erp/receipts";
import { confirmPaymentVoucherAction, deletePaymentVoucherAction } from "@/app/actions/erp/payments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function VoucherRowActions({
  voucherId,
  type,
  status,
  canManage,
}: {
  voucherId: string;
  type: "receipt" | "payment";
  status: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;
  const isReceipt = type === "receipt";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending}
        onClick={() => run(() => isReceipt ? confirmReceiptVoucherAction(voucherId) : confirmPaymentVoucherAction(voucherId), "تم تأكيد السند وترحيله")}>
        <Icon name="Check" className="size-4" />تأكيد
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف"
        onClick={() => run(() => isReceipt ? deleteReceiptVoucherAction(voucherId) : deletePaymentVoucherAction(voucherId), "تم حذف المسودة")}>
        <Icon name="Trash2" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
