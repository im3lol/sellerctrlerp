"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postPurchaseInvoiceAction, deletePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** Draft purchase invoice: post (if allowed) or delete the draft. */
export function PurchaseInvoiceDetailActions({ id, status, canPost, canManage }: { id: string; status: string; canPost: boolean; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (status !== "DRAFT") return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex flex-wrap gap-2">
      {canPost && (
        <Button size="sm" disabled={pending} onClick={() => run(() => postPurchaseInvoiceAction(id), "تم ترحيل الفاتورة محاسبياً")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}ترحيل
        </Button>
      )}
      {canManage && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deletePurchaseInvoiceAction(id), "تم حذف المسودة", "/erp/purchases/invoices")}>
          <Icon name="Trash2" className="size-4 text-destructive" />حذف
        </Button>
      )}
    </div>
  );
}
