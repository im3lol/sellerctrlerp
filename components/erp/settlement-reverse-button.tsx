"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { reverseAmazonSettlementAction } from "@/app/actions/erp/amazon-settlement";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/** Reverse the GL posting of ONE settlement (not the whole channel history). */
export function SettlementReverseButton({ channel, settlementId }: { channel: string; settlementId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () => void (async () => {
    if (!(await confirm({ title: "عكس ترحيل هذه التسوية؟", danger: true }))) return;
    start(async () => {
      const r = await reverseAmazonSettlementAction(channel, settlementId);
      if (r.ok) { toast.success(`تم عكس ${r.reversed.toLocaleString("ar-EG-u-nu-latn")} قيد`); router.refresh(); }
      else toast.error(r.error ?? "تعذّر العكس");
    });
  })();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={run} title="عكس ترحيل هذه التسوية فقط">
      <Icon name="Undo2" className="size-4 text-destructive" />عكس
    </Button>
  );
}
