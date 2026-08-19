"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postPurchaseInvoiceAction, deletePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { Button } from "@/components/ui/button";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/** Draft purchase invoice: post / delete. Posted: a "مرتجع" shortcut. */
export function PurchaseInvoiceDetailActions({ id, number, status, canPost, canManage }: { id: string; number: string; status: string; canPost: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء|عكس/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const printHref = `/purchases/invoices/${encodeURIComponent(number)}/print`;
  const items: DocAction[] = [{ label: "طباعة", icon: "Printer", href: printHref, newTab: true }];

  if (status === "DRAFT") {
    if (canManage) items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => deletePurchaseInvoiceAction(id), "تم حذف المسودة", "/purchases/invoices") });
  } else if (status !== "CANCELLED" && canManage) {
    items.push({ label: "مرتجع", icon: "Undo2", href: `/purchases/invoices/${encodeURIComponent(number)}/return` });
  }

  return (
    <DocumentActions
      primary={status === "DRAFT" && canPost ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => postPurchaseInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}تأكيد
        </Button>
      ) : undefined}
      items={items}
    />
  );
}
