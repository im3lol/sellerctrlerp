"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postSalesInvoiceAction, deleteSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { Button } from "@/components/ui/button";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { waNumber } from "@/lib/phone";

/** Draft sales invoice: post / delete. Posted: a "مرتجع" shortcut. */
export function SalesInvoiceDetailActions({
  id, number, status, canPost, canManage,
  totalAmount, customerPhone, customerEmail,
  balanceDue, canCollect,
}: {
  id: string; number: string; status: string; canPost: boolean; canManage: boolean;
  totalAmount?: string | null; customerPhone?: string | null; customerEmail?: string | null;
  balanceDue?: string | null; canCollect?: boolean;
}) {
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

  const printBtn = <PrintDocLink href={`/sales/invoices/${encodeURIComponent(number)}/print`} />;

  const fmt = (v: string | null | undefined) =>
    Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const shareMsg = `فاتورة رقم: ${number}\nالمبلغ الإجمالي: ${fmt(totalAmount)}\nللاستفسار أو الدفع يرجى التواصل معنا.`;

  const waPhone = waNumber(customerPhone);
  const waBtn = waPhone ? (
    <Button size="sm" variant="outline" asChild>
      <a href={`https://wa.me/${waPhone}?text=${encodeURIComponent(shareMsg)}`} target="_blank" rel="noopener">
        <Icon name="MessageCircle" className="size-4" />واتساب
      </a>
    </Button>
  ) : null;

  const emailBtn = customerEmail ? (
    <Button size="sm" variant="outline" asChild>
      <a href={`mailto:${customerEmail}?subject=${encodeURIComponent(`فاتورة رقم ${number}`)}&body=${encodeURIComponent(shareMsg)}`}>
        <Icon name="Mail" className="size-4" />إيميل
      </a>
    </Button>
  ) : null;

  if (status === "DRAFT") {
    return (
      <div className="flex flex-wrap gap-2">
        {canPost && (
          <Button size="sm" disabled={pending} onClick={() => run(() => postSalesInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}تأكيد
          </Button>
        )}
        {printBtn}
        {waBtn}
        {emailBtn}
        {canManage && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteSalesInvoiceAction(id), "تم حذف المسودة", "/sales/invoices")}>
            <Icon name="Trash2" className="size-4 text-destructive" />حذف
          </Button>
        )}
      </div>
    );
  }

  // Posted (not cancelled): allow collecting payment (if any balance due) + creating a return.
  if (status !== "CANCELLED" && (canManage || canCollect)) {
    const hasBalance = Number(balanceDue ?? 0) > 0;
    return (
      <div className="flex flex-wrap gap-2">
        {canCollect && hasBalance && (
          <Button size="sm" asChild>
            <Link href={`/sales/receipts/new?invoice=${encodeURIComponent(number)}`}><Icon name="HandCoins" className="size-4" />تحصيل</Link>
          </Button>
        )}
        {canManage && (
          <Button size="sm" variant="outline" asChild>
            <Link href={`/sales/invoices/${encodeURIComponent(number)}/return`}><Icon name="Undo2" className="size-4" />مرتجع</Link>
          </Button>
        )}
        {printBtn}
        {waBtn}
        {emailBtn}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {printBtn}
      {waBtn}
      {emailBtn}
    </div>
  );
}
