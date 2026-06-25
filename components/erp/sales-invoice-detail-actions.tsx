"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postSalesInvoiceAction, deleteSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/** Draft sales invoice: post / delete. Posted: a "مرتجع" shortcut. */
export function SalesInvoiceDetailActions({ id, number, status, canPost, canManage }: { id: string; number: string; status: string; canPost: boolean; canManage: boolean }) {
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

  const printBtn = (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/erp/sales/invoices/${encodeURIComponent(number)}/print`} target="_blank">
        <Icon name="Printer" className="size-4" />طباعة
      </Link>
    </Button>
  );

  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        {canPost && (
          <Button size="sm" disabled={pending} onClick={() => run(() => postSalesInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}تأكيد
          </Button>
        )}
        {printBtn}
        {canManage && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteSalesInvoiceAction(id), "تم حذف المسودة", "/erp/sales/invoices")}>
            <Icon name="Trash2" className="size-4 text-destructive" />حذف
          </Button>
        )}
      </div>
    );
  }

  // Posted (not cancelled): allow creating a return from this invoice.
  if (status !== "CANCELLED" && canManage) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" asChild>
          <Link href={`/erp/sales/invoices/${encodeURIComponent(number)}/return`}><Icon name="Undo2" className="size-4" />مرتجع</Link>
        </Button>
        {printBtn}
      </div>
    );
  }

  return printBtn;
}
