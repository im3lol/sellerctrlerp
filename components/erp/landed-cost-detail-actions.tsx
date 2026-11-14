"use client";

import { useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { postLandedCostVoucherAction, deleteLandedCostVoucherAction, cancelLandedCostVoucherAction, correctLandedCostVoucherAction } from "@/app/actions/erp/landed-costs";
import { deleteCancelledDocumentAction } from "@/app/actions/erp/doc-purge";
import { confirmPurge } from "@/components/erp/purge-confirm";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { DocumentActions, type DocAction } from "@/components/erp/document-actions";

/** DRAFT: post / delete. POSTED: cancel (reverses the revaluation + the GL). */
export function LandedCostDetailActions({ id, number, status, canManage, canPost }: { id: string; number: string; status: string; canManage: boolean; canPost: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>, ok: string, dest?: string) => {
    void (async () => {
      if (!(await confirm({ danger: /حذف|إلغاء/.test(ok) }))) return;
      start(async () => {
        const r = await fn();
        if (r.ok) { toast.success(ok); if (dest) router.push(dest); router.refresh(); }
        else toast.error(r.error ?? t("تعذّر التنفيذ"));
      });
    })();
  };

  const items: DocAction[] = [];
  if (status === "DRAFT" && canManage) {
    items.push({ label: "تعديل المسودة", icon: "Pencil", disabled: pending, onSelect: () => router.push(`/purchases/landed-costs/${encodeURIComponent(number)}/edit`) });
    items.push({ label: "حذف المسودة", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => run(() => deleteLandedCostVoucherAction(id), "تم حذف المسودة", "/purchases/landed-costs") });
  } else if (status === "POSTED" && canPost) {
    if (canManage) items.push({ label: "إلغاء وإنشاء مسودة تصحيح", icon: "Pencil", disabled: pending,
      onSelect: () => void (async () => {
        if (!(await confirm({ danger: true, title: t("تصحيح تكاليف الاستيراد"), description: t("سيُعكس أثر المستند السابق وتُنشأ مسودة بنفس البنود لتعديلها. لا تُحمّل التكاليف الجديدة إلا بعد حفظ المسودة وترحيلها.") }))) return;
        start(async () => {
          const r = await correctLandedCostVoucherAction(id);
          if (r.ok && r.number) { toast.success("تم إنشاء مسودة التصحيح وعكس المستند السابق"); router.push(`/purchases/landed-costs/${encodeURIComponent(r.number)}/edit`); router.refresh(); }
          else toast.error(r.error ?? t("تعذّر التنفيذ"));
        });
      })() });
    items.push({ label: "إلغاء المستند", icon: "Ban", danger: true, disabled: pending,
      onSelect: () => run(() => cancelLandedCostVoucherAction(id), "تم إلغاء المستند وعكس أثره") });
  } else if (status === "CANCELLED" && canPost) {
    items.push({ label: "حذف نهائي", icon: "Trash2", danger: true, disabled: pending,
      onSelect: () => void (async () => {
          if (!(await confirmPurge("مستند تكاليف الاستيراد"))) return;
          start(async () => {
            const r = await deleteCancelledDocumentAction("landedCost", id);
            if (r.ok) { toast.success("تم حذف المستند نهائياً"); router.push("/purchases/landed-costs"); router.refresh(); }
            else toast.error(r.error ?? t("تعذّر الحذف"));
          });
        })() });
  }

  return (
    <DocumentActions
      primary={status === "DRAFT" && canPost ? (
        <Button size="sm" disabled={pending} onClick={() => run(() => postLandedCostVoucherAction(id), "تم ترحيل التكاليف على المخزون")}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon name="Check" className="size-4" />}{t("ترحيل")}
        </Button>
      ) : undefined}
      items={items}
    />
  );
}
