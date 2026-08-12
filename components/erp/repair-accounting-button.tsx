"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { initializeChartAction } from "@/app/actions/erp/accounts";

/** Re-run the idempotent org bootstrap (chart of accounts, journals, period, warehouse,
 *  currency, default unit + cash customer). Shown on /setup when signup's best-effort init
 *  failed and left the org without a chart/warehouse — one click fixes it. */
export function RepairAccountingButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () => start(async () => {
    const r = await initializeChartAction();
    if ("ok" in r && r.ok) { toast.success("تم إصلاح التهيئة المحاسبية — دليل الحسابات والمستودع جاهزان"); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر الإصلاح");
  });
  return (
    <Button variant="default" className="gap-1.5" onClick={run} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />}إصلاح التهيئة المحاسبية
    </Button>
  );
}
