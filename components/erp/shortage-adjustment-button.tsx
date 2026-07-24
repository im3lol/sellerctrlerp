"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDeliveryShortageAdjustmentAction } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

/** One click: DRAFT deliveries' aggregated stock shortages → ONE DRAFT stock
 *  adjustment (جرد) the user reviews then posts. */
export function ShortageAdjustmentButton({ items }: { items: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} className="border-destructive/40 text-destructive hover:bg-destructive/10"
      onClick={() => start(async () => {
        const r = await createDeliveryShortageAdjustmentAction();
        if (r.ok && r.id) {
          toast.success(`تم إنشاء مسودة تسوية جرد (${r.count} صنف) — عدّ الكميات فعليًا ثم رحّلها`);
          router.push(`/inventory/adjustments/${r.id}`);
        } else toast.error(r.error ?? "تعذّر إنشاء التسوية");
      })}>
      <Icon name="PackageX" className="size-4" />
      تسوية النواقص ({items.toLocaleString("ar-EG-u-nu-latn")} صنف)
    </Button>
  );
}
