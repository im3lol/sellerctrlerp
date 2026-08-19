"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptAction, deleteReceiptAction, convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { type BulkRow } from "@/components/erp/barcode-print";

/** إذن استلام header: the workflow's next step stays a button, everything else folds into
 *  the shared «إجراءات» menu (components/erp/document-actions.tsx). */
export function ReceiptDetailActions({
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
      if (!(await confirm({ title: "تحويل لفاتورة", description: "إنشاء مسودة فاتورة شراء من هذا الإذن؟" }))) return;
      start(async () => {
        const r = await convertReceiptToInvoiceAction(id);
        if (r.ok) { toast.success("تم إنشاء مسودة فاتورة — راجِعها وأكّدها"); router.push(r.invoiceId ? `/purchases/invoices/${r.invoiceId}` : "/purchases/invoices"); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التحويل");
      });
    })();

  const items: DocAction[] = [{ label: "طباعة", icon: "Printer", href: printHref, newTab: true }];
  if (canManage) {
    if (status === "DRAFT") {
      items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
        onSelect: () => run(() => deleteReceiptAction(id), "تم حذف المسودة", "/purchases/receipts") });
    } else if (status === "RECEIVED" || status === "INVOICED") {
      if (status === "RECEIVED") items.push({ label: "تحويل لفاتورة", icon: "FileText", disabled: pending, onSelect: bill });
      items.push({ label: "مرتجع (إرجاع للمخزن)", icon: "Undo2", danger: true, disabled: pending,
        onSelect: () => router.push(`/purchases/receipts/${encodeURIComponent(number)}/return`) });
    }
  }

  return (
    <DocumentActions
      primary={canManage && status === "DRAFT" ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmReceiptAction(id), "تم تأكيد الاستلام وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد الاستلام
        </Button>
      ) : undefined}
      items={items}
      barcode={barcodeRows.length ? { docTitle: `إذن استلام ${number}`, rows: barcodeRows } : undefined}
    />
  );
}
