"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveMaterialRequestAction, deleteMaterialRequestAction } from "@/app/actions/erp/material-requests";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function RequisitionRowActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage) return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "تعذّر التنفيذ"); });

  return (
    <div className="flex gap-1">
      {status === "DRAFT" && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => approveMaterialRequestAction(id), "تم اعتماد الطلب")}><Icon name="Check" className="size-4" />اعتماد</Button>
          <Button size="sm" variant="outline" asChild><Link href={`/purchases/requisitions/${id}/edit`}><Icon name="Pencil" className="size-4" />تعديل</Link></Button>
          <Button size="icon" variant="ghost" disabled={pending} aria-label="حذف" onClick={() => run(() => deleteMaterialRequestAction(id), "تم الحذف")}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
        </>
      )}
      {status === "APPROVED" && (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/purchases/orders/new?fromRequisition=${id}`}><Icon name="ClipboardList" className="size-4" />تحويل لأمر شراء</Link>
        </Button>
      )}
    </div>
  );
}
