"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { confirmReceiptVoucherAction, deleteReceiptVoucherAction, reverseReceiptVoucherAction } from "@/app/actions/erp/receipts";
import { confirmPaymentVoucherAction, deletePaymentVoucherAction, reversePaymentVoucherAction } from "@/app/actions/erp/payments";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { confirm } from "@/components/erp/confirm";

/**
 * Header actions for a voucher detail page — mirrors sales-invoice-detail-actions.
 * DRAFT: تأكيد + حذف. POSTED: عكس. Always: طباعة. `canManage` = sales.collect
 * (receipt) / purchases.pay (payment) — the same permission the server enforces.
 */
export function VoucherDetailActions({
  id, number, type, status, canManage,
}: {
  id: string; number: string; type: "receipt" | "payment"; status: string; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isReceipt = type === "receipt";
  const listHref = isReceipt ? "/sales/receipts" : "/purchases/payments";
  const printHref = `${listHref}/${encodeURIComponent(number)}/print`;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, danger: boolean, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const items: DocAction[] = [{ label: "طباعة", icon: "Printer", href: printHref, newTab: true }];
  if (canManage && status === "DRAFT") {
    items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => isReceipt ? deleteReceiptVoucherAction(id) : deletePaymentVoucherAction(id), "تم حذف المسودة", true, listHref) });
  }
  if (canManage && status === "POSTED") {
    // Reversal writes a mirror entry and restores the customer/supplier + invoice balances.
    items.push({ label: "عكس السند", icon: "Undo2", danger: true, disabled: pending,
      onSelect: () => run(() => isReceipt ? reverseReceiptVoucherAction(id) : reversePaymentVoucherAction(id), "تم عكس السند", true) });
  }

  return (
    <DocumentActions
      primary={canManage && status === "DRAFT" ? (
        <Button size="sm" disabled={pending}
          onClick={() => run(() => isReceipt ? confirmReceiptVoucherAction(id) : confirmPaymentVoucherAction(id), "تم تأكيد السند وترحيله", false)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}تأكيد
        </Button>
      ) : undefined}
      items={items}
    />
  );
}
