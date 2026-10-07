"use client";

import { useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { reverseAmazonSettlementAction } from "@/app/actions/erp/amazon-settlement";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

/** Reverse the GL posting of ONE settlement (not the whole channel history). */
export function SettlementReverseButton({ channel, settlementId }: { channel: string; settlementId: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () => void (async () => {
    if (!(await confirm({ title: "عكس ترحيل هذه التسوية؟", danger: true }))) return;
    start(async () => {
      const r = await reverseAmazonSettlementAction(channel, settlementId);
      if (r.ok) { toast.success(fill(t("تم عكس {0} قيد"), [r.reversed.toLocaleString("ar-EG-u-nu-latn")])); router.refresh(); }
      else toast.error(r.error ?? t("تعذّر العكس"));
    });
  })();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={run} title={t("عكس ترحيل هذه التسوية فقط")}>
      <Icon name="Undo2" className="size-4 text-destructive" />{t("عكس")}
    </Button>
  );
}
