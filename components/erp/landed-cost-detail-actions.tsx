"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { postLandedCostVoucherAction, deleteLandedCostVoucherAction, cancelLandedCostVoucherAction } from "@/app/actions/erp/landed-costs";
import { deleteCancelledDocumentAction } from "@/app/actions/erp/doc-purge";
import { confirmPurge } from "@/components/erp/purge-confirm";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";

/** DRAFT: post / delete. POSTED: cancel (reverses the revaluation + the GL). */
export function LandedCostDetailActions({ id, status, canManage, canPost }: { id: string; status: string; canManage: boolean; canPost: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? "تعذّر التنفيذ");
      });
    })();
  };

  const items: DocAction[] = [];
  if (status === "DRAFT" && canManage) {
    items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => deleteLandedCostVoucherAction(id), "تم حذف المسودة", "/purchases/landed-costs") });
  } else if (status === "POSTED" && canPost) {
    items.push({ label: "إلغاء المستند", icon: "Ban", danger: true, disabled: pending,
      onSelect: () => run(() => cancelLandedCostVoucherAction(id), "تم إلغاء المستند وعكس أثره") });
  } else if (status === "CANCELLED" && canPost) {
    items.push({ label: "حذف نهائي", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => void (async () => {
          if (!(await confirmPurge("مستند تكاليف الاستيراد"))) return;
          start(async () => {
            const r = await deleteCancelledDocumentAction("landedCost", id);
            if (r.ok) { toast.success("تم حذف المستند نهائياً"); router.push("/purchases/landed-costs"); router.refresh(); }
            else toast.error(r.error ?? "تعذّر الحذف");
          });
        })() });
  }

  return (
    <DocumentActions
      primary={status === "DRAFT" && canPost ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => postLandedCostVoucherAction(id), "تم ترحيل التكاليف على المخزون")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}ترحيل
        </Button>
      ) : undefined}
      items={items}
    />
  );
}
