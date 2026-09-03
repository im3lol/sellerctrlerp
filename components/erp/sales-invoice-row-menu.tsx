"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postSalesInvoiceAction, deleteSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { confirm } from "@/components/erp/confirm";

/** Per-row "⋮" quick actions for the sales invoices list — same action set as
 *  SalesInvoiceDetailActions, minus the share/collect shortcuts, compacted. */
export function SalesInvoiceRowMenu({ id, number, status, canPost, canManage }: { id: string; number: string; status: string; canPost: boolean; canManage: boolean }) {
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
    { label: "فتح", icon: "Eye", href: `/sales/invoices/${encoded}` },
    { label: "طباعة", icon: "Printer", href: `/sales/invoices/${encoded}/print`, newTab: true },
  ];

  if (status === "DRAFT") {
    if (canPost) items.push({ label: "تأكيد", icon: "Check", disabled: pending, onSelect: () => run(() => postSalesInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً") });
    if (canManage) items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending, onSelect: () => run(() => deleteSalesInvoiceAction(id), "تم حذف المسودة", "/sales/invoices") });
  } else if (status !== "CANCELLED" && canManage) {
    items.push({ label: "مرتجع", icon: "Undo2", href: `/sales/invoices/${encodeURIComponent(number)}/return` });
  }

  return <DocumentActions items={items} compact />;
}
