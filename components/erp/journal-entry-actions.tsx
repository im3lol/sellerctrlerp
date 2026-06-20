"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { postDraftEntryAction, reverseEntryAction, deleteDraftEntryAction } from "@/app/actions/erp/journal";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function JournalEntryActions({
  entryId,
  status,
  isReversal,
  canPost,
  canReverse,
  canDelete,
}: {
  entryId: string;
  status: string;
  isReversal: boolean;
  canPost: boolean;
  canReverse: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmReverse, setConfirmReverse] = useState(false);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, success: string, after?: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        if (after) router.push(after);
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر تنفيذ الإجراء");
      }
    });

  return (
    <div className="flex flex-wrap gap-2">
      {status === "DRAFT" && canPost && (
        <Button disabled={pending} onClick={() => run(() => postDraftEntryAction(entryId), "تم ترحيل القيد")}>
          <Icon name="Check" className="size-4" />ترحيل
        </Button>
      )}
      {status === "DRAFT" && canDelete && (
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => run(() => deleteDraftEntryAction(entryId), "تم حذف المسودة", "/erp/accounting/journal")}
        >
          <Icon name="Trash2" className="size-4" />حذف
        </Button>
      )}
      {status === "POSTED" && !isReversal && canReverse && (
        confirmReverse ? (
          <>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => reverseEntryAction(entryId), "تم عكس القيد")}
            >
              <Icon name="Undo2" className="size-4" />تأكيد العكس
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => setConfirmReverse(false)}>
              إلغاء
            </Button>
          </>
        ) : (
          <Button variant="outline" disabled={pending} onClick={() => setConfirmReverse(true)}>
            <Icon name="Undo2" className="size-4" />عكس القيد
          </Button>
        )
      )}
    </div>
  );
}
