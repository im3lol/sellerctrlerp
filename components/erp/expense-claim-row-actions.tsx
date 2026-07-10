"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveExpenseClaimAction, deleteExpenseClaimAction } from "@/app/actions/erp/expense-claims";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ExpenseClaimRowActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "تعذّر التنفيذ"); });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => approveExpenseClaimAction(id), "تم اعتماد وترحيل المطالبة")}><Icon name="Check" className="size-4" />اعتماد وترحيل</Button>
      <Button size="icon" variant="ghost" disabled={pending} aria-label="حذف" onClick={() => run(() => deleteExpenseClaimAction(id), "تم الحذف")}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
    </div>
  );
}
