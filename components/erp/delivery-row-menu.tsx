"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDeliveryAction, deleteDeliveryAction, convertDeliveryToInvoiceAction } from "@/app/actions/erp/deliveries";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { confirm } from "@/components/erp/confirm";

/** Per-row "⋮" quick actions for the deliveries (إذن صرف) list — same action set
 *  as DeliveryDetailActions, compacted into a row menu (no barcode print here). */
export function DeliveryRowMenu({ id, number, status, canManage }: { id: string; number: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

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

  const bill = () =>
    void (async () => {
      if (!(await confirm({ title: "تحويل لفاتورة", description: "إنشاء مسودة فاتورة بيع من هذا الإذن؟" }))) return;
      start(async () => {
        const r = await convertDeliveryToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/sales/invoices/${r.invoiceId}` : "/sales/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    })();

  const encoded = encodeURIComponent(number);
  const items: DocAction[] = [
    { label: "فتح", icon: "Eye", href: `/sales/deliveries/${encoded}` },
    { label: "طباعة", icon: "Printer", href: `/sales/deliveries/${encoded}/print`, newTab: true },
  ];

  if (canManage) {
    if (status === "DRAFT") {
      items.push({ label: "تأكيد الصرف", icon: "Check", disabled: pending, onSelect: () => run(() => confirmDeliveryAction(id), "تم تأكيد إذن الصرف وترحيله") });
      items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending, onSelect: () => run(() => deleteDeliveryAction(id), "تم حذف المسودة", "/sales/deliveries") });
    } else if (status === "DELIVERED" || status === "INVOICED") {
      if (status === "DELIVERED") items.push({ label: "تحويل لفاتورة", icon: "FileText", disabled: pending, onSelect: bill });
      items.push({ label: "مرتجع (إرجاع للمخزن)", icon: "Undo2", danger: true, disabled: pending, onSelect: () => router.push(`/sales/deliveries/${encoded}/return`) });
    }
  }

  return <DocumentActions items={items} compact />;
}
