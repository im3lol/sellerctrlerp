"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postSalesInvoiceAction, deleteSalesInvoiceAction } from "@/app/actions/erp/sales-invoices";
import { Button } from "@/components/ui/button";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
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

  const fmt = (v: string | null | undefined) =>
    Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const shareMsg = `فاتورة رقم: ${number}
المبلغ الإجمالي: ${fmt(totalAmount)}
للاستفسار أو الدفع يرجى التواصل معنا.`;
  const waPhone = waNumber(customerPhone);
  const hasBalance = Number(balanceDue ?? 0) > 0;

  // Print / share need no write permission — a viewer may still send the customer a copy.
  const items: DocAction[] = [{ label: "طباعة", icon: "Printer", href: `/sales/invoices/${encodeURIComponent(number)}/print`, newTab: true }];
  if (waPhone) items.push({ label: "واتساب", icon: "MessageCircle", newTab: true,
    href: `https://wa.me/${waPhone}?text=${encodeURIComponent(shareMsg)}` });
  if (customerEmail) items.push({ label: "إيميل", icon: "Mail",
    href: `mailto:${customerEmail}?subject=${encodeURIComponent(`فاتورة رقم ${number}`)}&body=${encodeURIComponent(shareMsg)}` });

  if (status === "DRAFT") {
    if (canManage) items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => deleteSalesInvoiceAction(id), "تم حذف المسودة", "/sales/invoices") });
  } else if (status !== "CANCELLED" && canManage) {
    items.push({ label: "مرتجع", icon: "Undo2", href: `/sales/invoices/${encodeURIComponent(number)}/return` });
  }

  // Collecting a payment is the next step on an unpaid posted invoice, so it stays visible.
  const primary =
    status === "DRAFT" && canPost ? (
      <Button size="sm" disabled={pending} onClick={() => run(() => postSalesInvoiceAction(id), "تم تأكيد الفاتورة وترحيلها محاسبياً")}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}تأكيد
      </Button>
    ) : status !== "CANCELLED" && canCollect && hasBalance ? (
      <Button size="sm" asChild>
        <Link href={`/sales/receipts/new?invoice=${encodeURIComponent(number)}`}><Icon name="HandCoins" className="size-4" />تحصيل</Link>
      </Button>
    ) : undefined;

  return <DocumentActions primary={primary} items={items} />;
}
