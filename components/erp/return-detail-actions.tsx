"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmSalesReturnAction, deleteSalesReturnAction, reverseSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { confirmPurchaseReturnAction, deletePurchaseReturnAction, reversePurchaseReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { deleteCancelledDocumentAction } from "@/app/actions/erp/doc-purge";
import { confirmPurge } from "@/components/erp/purge-confirm";

/** Manage a return from its detail page: delete a draft, or cancel (reverse) a posted one. */
export function ReturnDetailActions({ id, type, status, canManage, dest: destProp }: { id: string; type: "sales" | "purchase"; status: string; canManage: boolean; dest?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const dest = destProp ?? (type === "sales" ? "/sales/invoices" : "/purchases/invoices");
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء|عكس/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const items: DocAction[] = [];
  if (status === "DRAFT") {
    items.push({ label: "حذف المرتجع", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => type === "sales" ? deleteSalesReturnAction(id) : deletePurchaseReturnAction(id), "تم حذف المرتجع") });
  } else if (status === "POSTED") {
    items.push({ label: "إلغاء المرتجع", icon: "X", danger: true, disabled: pending,
      onSelect: () => run(() => type === "sales" ? reverseSalesReturnAction(id) : reversePurchaseReturnAction(id), "تم إلغاء المرتجع وعكسه") });
  } else if (status === "CANCELLED") {
    items.push({ label: "حذف نهائي", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => void (async () => {
        const label = type === "sales" ? "مرتجع البيع" : "مرتجع الشراء";
        if (!(await confirmPurge(label))) return;
        start(async () => {
          const r = await deleteCancelledDocumentAction(type === "sales" ? "salesReturn" : "purchaseReturn", id);
          if (r.ok) { toast.success("تم حذف المرتجع نهائياً"); router.push(dest); router.refresh(); }
          else toast.error(r.error ?? "تعذّر الحذف");
        });
      })() });
  }

  return (
    <DocumentActions
      primary={status === "DRAFT" ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => type === "sales" ? confirmSalesReturnAction(id) : confirmPurchaseReturnAction(id), "تم تأكيد المرتجع وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد المرتجع
        </Button>
      ) : undefined}
      items={items}
    />
  );
}
