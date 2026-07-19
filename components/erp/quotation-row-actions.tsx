"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setQuotationStatusAction, deleteQuotationAction } from "@/app/actions/erp/quotations";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function QuotationRowActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "تعذّر التنفيذ"); });

  return (
    <div className="flex flex-wrap gap-1">
      {status === "DRAFT" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setQuotationStatusAction(id, "SENT"), "تم وضع علامة مُرسل")}><Icon name="Send" className="size-4" />إرسال</Button>
      )}
      {status === "SENT" && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => setQuotationStatusAction(id, "ACCEPTED"), "تم قبول العرض")}><Icon name="Check" className="size-4" />قبول</Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setQuotationStatusAction(id, "REJECTED"), "تم رفض العرض")}>رفض</Button>
        </>
      )}
      {status === "ACCEPTED" && (
        <Button size="sm" asChild><Link href={`/sales/orders/new?fromQuotation=${id}`}><Icon name="ClipboardList" className="size-4" />تحويل لأمر بيع</Link></Button>
      )}
      {status !== "ACCEPTED" && (
        <Button size="icon" variant="ghost" disabled={pending} aria-label="حذف" onClick={() => run(() => deleteQuotationAction(id), "تم الحذف")}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
      )}
    </div>
  );
}
