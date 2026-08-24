"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
import { refreshPlatformBalanceAction } from "@/app/actions/erp/marketplace-sync";
import { Button } from "@/components/ui/button";

/** Re-read the marketplace's reported balance. It refreshes with every payments sync
 *  anyway; this is for the moment you are staring at the two numbers and want to be
 *  sure the difference is real and not just stale. */
export function PlatformBalanceRefresh({ code }: { code: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = () => start(async () => {
    const r = await refreshPlatformBalanceAction(code);
    if (r.ok) { toast.success("تم تحديث رصيد المنصّة"); router.refresh(); }
    else toast.error(r.error ?? "تعذّر تحديث الرصيد");
  });

  return (
    <Button variant="outline" size="sm" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}تحديث رصيد المنصّة
    </Button>
  );
}
