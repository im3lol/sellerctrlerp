"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveLeaveRequestAction, rejectLeaveRequestAction, deleteLeaveRequestAction } from "@/app/actions/erp/leave-requests";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function LeaveRequestRowActions({ id, status, canManage }: { id: string; status: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!canManage || status !== "DRAFT") return null;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string) =>
    start(async () => { const r = await fn(); if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error ?? "تعذّر التنفيذ"); });

  return (
    <div className="flex gap-1">
      <Button size="sm" disabled={pending} onClick={() => run(() => approveLeaveRequestAction(id), "تم اعتماد الإجازة")}><Icon name="Check" className="size-4" />اعتماد</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectLeaveRequestAction(id), "تم رفض الطلب")}><Icon name="X" className="size-4" />رفض</Button>
      <Button size="icon" variant="ghost" disabled={pending} aria-label="حذف" onClick={() => run(() => deleteLeaveRequestAction(id), "تم الحذف")}><Icon name="Trash2" className="size-4 text-destructive" /></Button>
    </div>
  );
}
