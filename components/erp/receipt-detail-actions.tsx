"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptAction, deleteReceiptAction, convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ReceiptDetailActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  // DRAFT: confirm (post) or delete the draft.
  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmReceiptAction(id), "تم تأكيد الاستلام وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد الاستلام
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteReceiptAction(id), "تم حذف المسودة", "/erp/purchases/receipts")}>
          <Icon name="Trash2" className="size-4 text-destructive" />حذف
        </Button>
      </div>
    );
  }

  // RECEIVED (posted, not yet billed): create a DRAFT purchase invoice and land on it.
  if (status === "RECEIVED") {
    const bill = () =>
      start(async () => {
        const r = await convertReceiptToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/erp/purchases/invoices/${r.invoiceId}` : "/erp/purchases/invoices"); router.refresh(); }
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
