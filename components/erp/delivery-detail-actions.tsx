"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDeliveryAction, deleteDeliveryAction, convertDeliveryToInvoiceAction, reverseDeliveryAction } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function DeliveryDetailActions({ id, status, canManage, invoiceNumber }: { id: string; status: string; canManage: boolean; invoiceNumber?: string | null }) {
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
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmDeliveryAction(id), "تم تأكيد إذن الصرف وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد الصرف
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteDeliveryAction(id), "تم حذف المسودة", "/erp/sales/deliveries")}>
          <Icon name="Trash2" className="size-4 text-destructive" />حذف
        </Button>
      </div>
    );
  }

  // DELIVERED (posted, not billed): bill it, or reverse the whole delivery (reopens the order).
  if (status === "DELIVERED") {
    const bill = () =>
      start(async () => {
        const r = await convertDeliveryToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/erp/sales/invoices/${r.invoiceId}` : "/erp/sales/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={bill}><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reverseDeliveryAction(id), "تم عكس الصرف — أُعيد فتح الأمر")}>
          <Icon name="Undo2" className="size-4 text-destructive" />مرتجع/عكس
        </Button>
      </div>
    );
  }

  // INVOICED: a return goes through the invoice (credit note).
  if (status === "INVOICED" && invoiceNumber) {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link href={`/erp/sales/invoices/${encodeURIComponent(invoiceNumber)}/return`}><Icon name="Undo2" className="size-4" />مرتجع</Link>
      </Button>
    );
  }

  return null; // REVERSED — nothing to do
}
