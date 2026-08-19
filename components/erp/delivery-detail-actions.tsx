"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmDeliveryAction, deleteDeliveryAction, convertDeliveryToInvoiceAction } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { type BulkRow } from "@/components/erp/barcode-print";

/** إذن صرف header: the workflow's next step stays a button, everything else folds into
 *  the shared «إجراءات» menu (components/erp/document-actions.tsx). */
export function DeliveryDetailActions({
  id, number, status, canManage, printHref, barcodeRows = [],
}: {
  id: string; number: string; status: string; canManage: boolean;
  printHref: string; barcodeRows?: BulkRow[];
}) {
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

  const items: DocAction[] = [{ label: "طباعة", icon: "Printer", href: printHref, newTab: true }];
  if (canManage) {
    if (status === "DRAFT") {
      items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
        onSelect: () => run(() => deleteDeliveryAction(id), "تم حذف المسودة", "/sales/deliveries") });
    } else if (status === "DELIVERED" || status === "INVOICED") {
      if (status === "DELIVERED") items.push({ label: "تحويل لفاتورة", icon: "FileText", disabled: pending, onSelect: bill });
      items.push({ label: "مرتجع (إرجاع للمخزن)", icon: "Undo2", danger: true, disabled: pending,
        onSelect: () => router.push(`/sales/deliveries/${encodeURIComponent(number)}/return`) });
    }
  }

  return (
    <DocumentActions
      primary={canManage && status === "DRAFT" ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmDeliveryAction(id), "تم تأكيد إذن الصرف وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد الصرف
        </Button>
      ) : undefined}
      items={items}
      barcode={barcodeRows.length ? { docTitle: `إذن صرف ${number}`, rows: barcodeRows } : undefined}
    />
  );
}
