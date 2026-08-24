"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { setQuotationStatusAction, deleteQuotationAction } from "@/app/actions/erp/quotations";
import { Button } from "@/components/ui/button";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { waNumber } from "@/lib/phone";

/**
 * The quotation's header actions, in the same shape as every other document: the next
 * step in the cycle as a visible primary button, everything else behind «إجراءات».
 *
 * The quotation was the one sales document with no «تأكيد» — it offered «إرسال» as an
 * outline button of the same weight as «تعديل» and «حذف», so the step that closes the
 * draft did not look like the step that closes the draft. It is the same transition
 * (DRAFT → SENT, after which the quote can no longer be edited); only the name and the
 * emphasis change, to match the rest of the cycle.
 */
export function QuotationDetailActions({
  id, number, status, canManage, total, customerPhone, customerEmail,
}: {
  id: string;
  number: string;
  status: string;
  canManage: boolean;
  total?: number;
  customerPhone?: string | null;
  customerEmail?: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|رفض/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const shareMsg = `عرض سعر رقم: ${number}${total != null ? `\nالإجمالي: ${fmt(total)}` : ""}\nفي انتظار ردكم، وشكراً لثقتكم.`;
  const waPhone = waNumber(customerPhone);

  // Print and share need no write permission — a viewer may still send the customer a copy.
  const items: DocAction[] = [
    { label: "طباعة", icon: "Printer", href: `/sales/quotations/${encodeURIComponent(number)}/print`, newTab: true },
  ];
  if (waPhone) items.push({ label: "واتساب", icon: "MessageCircle", newTab: true,
    href: `https://wa.me/${waPhone}?text=${encodeURIComponent(shareMsg)}` });
  if (customerEmail) items.push({ label: "إيميل", icon: "Mail",
    href: `mailto:${customerEmail}?subject=${encodeURIComponent(`عرض سعر رقم ${number}`)}&body=${encodeURIComponent(shareMsg)}` });

  if (canManage) {
    if (status === "DRAFT") items.push({ label: "تعديل", icon: "Pencil", href: `/sales/quotations/${encodeURIComponent(number)}/edit` });
    if (status === "SENT") items.push({ label: "تسجيل رفض العميل", icon: "X", danger: true, disabled: pending,
      onSelect: () => run(() => setQuotationStatusAction(id, "REJECTED"), "تم تسجيل رفض العرض") });
    if (status !== "ACCEPTED") items.push({ label: "حذف", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => deleteQuotationAction(id), "تم الحذف", "/sales/quotations") });
  }

  const step = (label: string, icon: string, onClick: () => void) => (
    <Button size="sm" disabled={pending} onClick={onClick}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name={icon} className="size-4" />}{label}
    </Button>
  );

  const primary = !canManage ? undefined
    : status === "DRAFT" ? step("تأكيد", "Check", () => run(() => setQuotationStatusAction(id, "SENT"), "تم تأكيد عرض السعر — جاهز للإرسال للعميل"))
    : status === "SENT" ? step("قبول العميل", "ThumbsUp", () => run(() => setQuotationStatusAction(id, "ACCEPTED"), "تم قبول العرض"))
    : status === "ACCEPTED" ? (
      <Button size="sm" asChild>
        <Link href={`/sales/orders/new?fromQuotation=${id}`}><Icon name="ClipboardList" className="size-4" />تحويل لأمر بيع</Link>
      </Button>
    ) : undefined;

  return <DocumentActions primary={primary} items={items} />;
}
