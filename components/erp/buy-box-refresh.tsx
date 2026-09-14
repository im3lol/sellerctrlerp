"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { startOffersRefreshAction } from "@/app/actions/erp/buy-box";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";

export function BuyBoxRefresh({ code }: { code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await startOffersRefreshAction(code);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحديث"); return; }
      toast.success(r.started ? "بدأ التحديث — الأرقام هتتحدّث خلال دقيقة أو اتنين" : "اتحدّث");
      router.refresh();
    })}>
      {pending ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="RefreshCw" className="size-4" />}حدّث دلوقتي
    </Button>
  );
}
