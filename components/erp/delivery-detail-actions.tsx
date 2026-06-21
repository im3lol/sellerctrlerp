"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDeliveryAction, deleteDeliveryAction, convertDeliveryToInvoiceAction } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function DeliveryDetailActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  // DRAFT: confirm (post stock OUT + COGS) or delete the draft.
  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmDeliveryAction(id), "تم تأكيد التسليم وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد التسليم
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteDeliveryAction(id), "تم حذف المسودة", "/erp/sales/deliveries")}>
          <Icon name="Trash2" className="size-4 text-destructive" />حذف
        </Button>
      </div>
    );
  }

  // DELIVERED (posted, not billed): create a DRAFT sales invoice and land on it.
  if (status === "DELIVERED") {
    const bill = () =>
      start(async () => {
        const r = await convertDeliveryToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/erp/sales/invoices/${r.invoiceId}` : "/erp/sales/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={bill}>
        <Icon name="FileText" className="size-4" />تحويل لفاتورة
      </Button>
    );
  }

  return null; // INVOICED — nothing to do
}
