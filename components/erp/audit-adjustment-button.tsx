"use client";

import { useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { createAdjustmentFromAuditAction } from "@/app/actions/erp/fba-inventory";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** One click: the latest audit's LOST/FOUND lines → ONE DRAFT stock adjustment
 *  (set to Amazon's qty, in the audit's warehouse) the user reviews then posts. */
export function AuditAdjustmentButton() {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending}
      onClick={() => start(async () => {
        const r = await createAdjustmentFromAuditAction();
        if (r.ok && r.id) {
          toast.success(fill(t("تم إنشاء مسودة تسوية ({0} صنف) — راجعها ثم رحّلها"), [r.count]));
          router.push(`/inventory/adjustments/${encodeURIComponent(r.number!)}`);
        } else toast.error(r.error ?? t("تعذّر إنشاء التسوية"));
      })}>
      <Icon name="ClipboardCheck" className="size-4" />
      {t("إنشاء تسوية من الفروقات")}
    </Button>
  );
}
