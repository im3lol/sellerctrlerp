"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptAction, deleteReceiptAction, convertReceiptToInvoiceAction, reverseReceiptAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ReceiptDetailActions({ id, status, canManage, invoiceNumber }: { id: string; status: string; canManage: boolean; invoiceNumber?: string | null }) {
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

  // RECEIVED (posted, not yet billed): bill it, or reverse the whole receipt (reopens the order).
  if (status === "RECEIVED") {
    const bill = () =>
      start(async () => {
        const r = await convertReceiptToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/erp/purchases/invoices/${r.invoiceId}` : "/erp/purchases/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={bill}><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reverseReceiptAction(id), "تم عكس الاستلام — أُعيد فتح الأمر")}>
          <Icon name="Undo2" className="size-4 text-destructive" />مرتجع/عكس
        </Button>
      </div>
    );
  }

  // INVOICED: a return goes through the invoice (credit/debit note).
  if (status === "INVOICED" && invoiceNumber) {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href={`/erp/purchases/invoices/${encodeURIComponent(invoiceNumber)}/return`}><Icon name="Undo2" className="size-4" />مرتجع</Link>
      </Button>
    );
  }

  return null; // REVERSED — nothing to do
}
