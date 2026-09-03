"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postPurchaseInvoiceAction, deletePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { confirm } from "@/components/erp/confirm";

/** Per-row "⋮" quick actions for the purchase invoices list — same action set as
 *  PurchaseInvoiceDetailActions, compacted into a row menu. */
export function PurchaseInvoiceRowMenu({ id, number, status, canPost, canManage }: { id: string; number: string; status: string; canPost: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const encoded = encodeURIComponent(number);
  const items: DocAction[] = [
    { label: "فتح", icon: "Eye", href: `/purchases/invoices/${encoded}` },
    { label: "طباعة", icon: "Printer", href: `/purchases/invoices/${encoded}/print`, newTab: true },
    { label: "تنزيل Excel", icon: "FileSpreadsheet", href: `/api/erp/purchases/invoices/export?numbers=${encoded}` },
  ];

  if (status === "DRAFT") {
    if (canPost) items.push({ label: "تأكيد", icon: "Check", disabled: pending, onSelect: () => run(() => postPurchaseInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً") });
    if (canManage) items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending, onSelect: () => run(() => deletePurchaseInvoiceAction(id), "تم حذف المسودة", "/purchases/invoices") });
  } else if (status !== "CANCELLED" && canManage) {
    items.push({ label: "مرتجع", icon: "Undo2", href: `/purchases/invoices/${encoded}/return` });
  }

  return <DocumentActions items={items} compact />;
}
