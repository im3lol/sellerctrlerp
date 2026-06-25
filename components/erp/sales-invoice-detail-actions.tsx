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
export function SalesInvoiceDetailActions({
  id, number, status, canPost, canManage,
  totalAmount, customerPhone, customerEmail,
}: {
  id: string; number: string; status: string; canPost: boolean; canManage: boolean;
  totalAmount?: string | null; customerPhone?: string | null; customerEmail?: string | null;
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

  const printBtn = (
    <Button size="sm" variant="outline" asChild>
      <Link href={`/erp/sales/invoices/${encodeURIComponent(number)}/print`} target="_blank">
        <Icon name="Printer" className="size-4" />طباعة
      </Link>
    </Button>
  );

  const fmt = (v: string | null | undefined) =>
    Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const shareMsg = `فاتورة رقم: ${number}\nالمبلغ الإجمالي: ${fmt(totalAmount)}\nللاستفسار أو الدفع يرجى التواصل معنا.`;

  const waPhone = customerPhone?.replace(/[\s\-\(\)]/g, "").replace(/^0/, "966");
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
