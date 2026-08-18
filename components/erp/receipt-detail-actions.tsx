"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmReceiptAction, deleteReceiptAction, convertReceiptToInvoiceAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { BulkBarcodePrintButton, type BulkRow } from "@/components/erp/barcode-print";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/**
 * The receipt header's single «إجراءات» menu.
 *
 * These four used to sit in the header as four separate buttons (طباعة · طباعة باركود ·
 * تحويل لفاتورة · مرتجع), which is most of a title bar spent on things you press rarely.
 * One trigger holds them now. The DRAFT case keeps «تأكيد الاستلام» as a visible button —
 * it is the whole point of a draft, and burying the next workflow step behind a menu is
 * the one thing this pattern should not do; everything else folds in beside it.
 *
 * The barcode dialog is driven in controlled mode: a menu item cannot host it directly
 * (picking the item closes the menu and would unmount the dialog with it), so the dialog
 * lives here as a sibling and the item only flips its state.
 */
export function ReceiptDetailActions({
  id, number, status, canManage, printHref, barcodeRows,
}: {
  id: string; number: string; status: string; canManage: boolean;
  printHref: string; barcodeRows: BulkRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [barcodeOpen, setBarcodeOpen] = useState(false);

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

  // Printing needs no write permission — a viewer may still take the document to paper.
  const printItems = (
    <>
      <DropdownMenuItem asChild>
        <Link href={printHref} target="_blank" rel="noopener"><Icon name="Printer" className="size-4" />طباعة</Link>
      </DropdownMenuItem>
      {barcodeRows.length > 0 && (
        <DropdownMenuItem onSelect={() => setBarcodeOpen(true)}>
          <Icon name="Barcode" className="size-4" />طباعة باركود
        </DropdownMenuItem>
      )}
    </>
  );

  const manageItems = !canManage ? null : status === "DRAFT" ? (
    <DropdownMenuItem disabled={pending} onSelect={() => run(() => deleteReceiptAction(id), "تم حذف المسودة", "/purchases/receipts")}>
      <Icon name="Trash2" className="size-4 text-destructive" />حذف المسودة
    </DropdownMenuItem>
  ) : status === "RECEIVED" || status === "INVOICED" ? (
    <>
      {status === "RECEIVED" && (
        <DropdownMenuItem disabled={pending} onSelect={bill}>
          <Icon name="FileText" className="size-4" />تحويل لفاتورة
        </DropdownMenuItem>
      )}
      <DropdownMenuItem disabled={pending} onSelect={() => router.push(`/purchases/receipts/${encodeURIComponent(number)}/return`)}>
        <Icon name="Undo2" className="size-4 text-destructive" />مرتجع (إرجاع للمخزن)
      </DropdownMenuItem>
    </>
  ) : null; // REVERSED — nothing to manage

  return (
    <div className="flex flex-wrap gap-2">
      {canManage && status === "DRAFT" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => confirmReceiptAction(id), "تم تأكيد الاستلام وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد الاستلام
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>
            <Icon name="Ellipsis" className="size-4" />إجراءات
            <Icon name="ChevronDown" className="size-3.5 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {printItems}
          {manageItems && <DropdownMenuSeparator />}
          {manageItems}
        </DropdownMenuContent>
      </DropdownMenu>

      <BulkBarcodePrintButton docTitle={`إذن استلام ${number}`} rows={barcodeRows} open={barcodeOpen} onOpenChange={setBarcodeOpen} hideTrigger />
    </div>
  );
}
