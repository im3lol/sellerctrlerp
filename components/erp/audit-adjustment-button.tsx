"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createAdjustmentFromAuditAction } from "@/app/actions/erp/fba-inventory";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** One click: the latest audit's LOST/FOUND lines → ONE DRAFT stock adjustment
 *  (set to Amazon's qty, in the audit's warehouse) the user reviews then posts. */
export function AuditAdjustmentButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending}
      onClick={() => start(async () => {
        const r = await createAdjustmentFromAuditAction();
        if (r.ok && r.id) {
          toast.success(`تم إنشاء مسودة تسوية (${r.count} صنف) — راجعها ثم رحّلها`);
          router.push(`/inventory/adjustments/${r.id}`);
        } else toast.error(r.error ?? "تعذّر إنشاء التسوية");
      })}>
      <Icon name="ClipboardCheck" className="size-4" />
      إنشاء تسوية من الفروقات
    </Button>
  );
}
