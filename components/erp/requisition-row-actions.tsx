"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n/client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveMaterialRequestAction, deleteMaterialRequestAction } from "@/app/actions/erp/material-requests";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function RequisitionRowActions({ id, number, status, canManage }: { id: string; number: string; status: string; canManage: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "تعذّر التنفيذ"); });

  return (
    <div className="flex gap-1">
      {status === "DRAFT" && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => approveMaterialRequestAction(id), "تم اعتماد الطلب")}><Icon name="Check" className="size-4" />{t("اعتماد")}</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/purchases/requisitions/${encodeURIComponent(number)}/edit`}><Icon name="Pencil" className="size-4" />{t("تعديل")}</Link></Button>
          <Button size="icon" variant="ghost" disabled={pending} aria-label={t("حذف")} onClick={() => run(() => deleteMaterialRequestAction(id), "تم الحذف")}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
        </>
      )}
      {status === "APPROVED" && (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/purchases/orders/new?fromRequisition=${id}`}><Icon name="ClipboardList" className="size-4" />{t("تحويل لأمر شراء")}</Link>
        </Button>
      )}
    </div>
  );
}
