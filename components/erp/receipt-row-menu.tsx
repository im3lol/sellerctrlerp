"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptAction, deleteReceiptAction, convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { confirm } from "@/components/erp/confirm";

/** Per-row "⋮" quick actions for the goods receipts (إذن استلام) list — same
 *  action set as ReceiptDetailActions, compacted into a row menu. */
export function ReceiptRowMenu({ id, number, status, canManage }: { id: string; number: string; status: string; canManage: boolean }) {
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
      if (!(await confirm({ title: "تحويل لفاتورة", description: "إنشاء مسودة فاتورة شراء من هذا الإذن؟" }))) return;
      start(async () => {
        const r = await convertReceiptToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/purchases/invoices/${r.invoiceId}` : "/purchases/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    })();

  const encoded = encodeURIComponent(number);
  const items: DocAction[] = [
    { label: "فتح", icon: "Eye", href: `/purchases/receipts/${encoded}` },
    { label: "طباعة", icon: "Printer", href: `/purchases/receipts/${encoded}/print`, newTab: true },
    { label: "تنزيل Excel", icon: "FileSpreadsheet", href: `/api/erp/purchases/receipts/export?numbers=${encoded}` },
  ];

  if (canManage) {
    if (status === "DRAFT") {
      items.push({ label: "تأكيد الاستلام", icon: "Check", disabled: pending, onSelect: () => run(() => confirmReceiptAction(id), "تم تأكيد الاستلام وترحيله") });
      items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending, onSelect: () => run(() => deleteReceiptAction(id), "تم حذف المسودة", "/purchases/receipts") });
    } else if (status === "RECEIVED" || status === "INVOICED") {
      if (status === "RECEIVED") items.push({ label: "تحويل لفاتورة", icon: "FileText", disabled: pending, onSelect: bill });
      items.push({ label: "مرتجع (إرجاع للمخزن)", icon: "Undo2", danger: true, disabled: pending, onSelect: () => router.push(`/purchases/receipts/${encoded}/return`) });
    }
  }

  return <DocumentActions items={items} compact />;
}
