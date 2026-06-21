"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmSalesReturnAction, deleteSalesReturnAction, reverseSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { confirmPurchaseReturnAction, deletePurchaseReturnAction, reversePurchaseReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/** Manage a return from its detail page: delete a draft, or cancel (reverse) a posted one. */
export function ReturnDetailActions({ id, type, status, canManage, dest: destProp }: { id: string; type: "sales" | "purchase"; status: string; canManage: boolean; dest?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const dest = destProp ?? (type === "sales" ? "/erp/sales/invoices" : "/erp/purchases/invoices");
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

  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => type === "sales" ? confirmSalesReturnAction(id) : confirmPurchaseReturnAction(id), "تم تأكيد المرتجع وترحيله")}>
          <Icon name="Check" className="size-4" />تأكيد المرتجع
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => type === "sales" ? deleteSalesReturnAction(id) : deletePurchaseReturnAction(id), "تم حذف المرتجع")}>
          <Icon name="Trash2" className="size-4 text-destructive" />حذف
        </Button>
      </div>
    );
  }

  if (status === "POSTED") {
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => type === "sales" ? reverseSalesReturnAction(id) : reversePurchaseReturnAction(id), "تم إلغاء المرتجع وعكسه")}>
        <Icon name="X" className="size-4 text-destructive" />إلغاء المرتجع
      </Button>
    );
  }

  return null; // CANCELLED — nothing to do
}
