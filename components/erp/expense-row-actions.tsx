"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmExpenseAction, deleteExpenseAction } from "@/app/actions/erp/expenses";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function ExpenseRowActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast.success(ok); router.refresh(); }
      else toast.error(r.error ?? "تعذّر التنفيذ");
    });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => confirmExpenseAction(id), "تم تأكيد المصروف وترحيله")}>
        <Icon name="Check" className="size-4" />تأكيد
      </Button>
      <Button size="sm" variant="outline" asChild><Link href={`/accounting/expenses/${id}/edit`}><Icon name="Pencil" className="size-4" />تعديل</Link></Button>
      <Button size="sm" variant="ghost" disabled={pending} aria-label="حذف" onClick={() => run(() => deleteExpenseAction(id), "تم حذف المسودة")}>
        <Icon name="Trash2" className="size-4 text-destructive" />
      </Button>
    </div>
  );
}
