"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDeliveryAction, deleteDeliveryAction, convertDeliveryToInvoiceAction, reverseDeliveryAction } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

export function DeliveryDetailActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء|عكس|مرتجع/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

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

  // DELIVERED / INVOICED: bill it (if not yet) and/or take the stock back into the warehouse.
  if (status === "DELIVERED" || status === "INVOICED") {
    const bill = () =>
      void (async () => {
        if (!(await confirm({ title: "تحويل لفاتورة", description: "إنشاء مسودة فاتورة بيع من هذا الإذن؟" }))) return;
        start(async () => {
          const r = await convertDeliveryToInvoiceAction(id);
          if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/erp/sales/invoices/${r.invoiceId}` : "/erp/sales/invoices"); router.refresh(); }
          else toast.error(r.error ?? "تعذّر التحويل");
        });
      })();
    return (
      <div className="flex flex-wrap gap-2">
        {status === "DELIVERED" && <Button size="sm" variant="outline" disabled={pending} onClick={bill}><Icon name="FileText" className="size-4" />تحويل لفاتورة</Button>}
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => reverseDeliveryAction(id), "تم إرجاع البضاعة للمخزن — أُعيد فتح الأمر")}>
          <Icon name="Undo2" className="size-4 text-destructive" />مرتجع (إرجاع للمخزن)
        </Button>
      </div>
    );
  }

  return null; // REVERSED — nothing to do
}
