"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteSalesReturnAction, reverseSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { deletePurchaseReturnAction, reversePurchaseReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** Manage a return from its detail page: delete a draft, or cancel (reverse) a posted one. */
export function ReturnDetailActions({ id, type, status, canManage }: { id: string; type: "sales" | "purchase"; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const dest = type === "sales" ? "/erp/sales/invoices" : "/erp/purchases/invoices";
  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  if (status === "DRAFT") {
    return (
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => type === "sales" ? deleteSalesReturnAction(id) : deletePurchaseReturnAction(id), "تم حذف المرتجع")}>
        <Icon name="Trash2" className="size-4 text-destructive" />حذف المرتجع
      </Button>
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
