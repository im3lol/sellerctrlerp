"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { HandCoins, Loader2, Link2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { confirmReimbursementAction } from "@/app/actions/erp/platform-reimbursements";
import type { ReimbursementRow } from "@/lib/erp/reimbursements-core";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString("ar-EG-u-nu-latn", { dateStyle: "short" }) : "—");

/**
 * Marketplace reimbursements awaiting recognition. Confirm → a DRAFT journal entry
 * (Dr wallet / Cr 4103 تعويضات المنصات) the accountant reviews + posts. Each row shows the
 * loss it compensates (a return not received / a disposed removal) when we can match it.
 */
export function MarketplaceReimbursementsClient({ initial }: { initial: ReimbursementRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const confirm = (id: string) => start(async () => {
    setBusy(id);
    const r = await confirmReimbursementAction(id);
    if ("error" in r) toast.error(r.error);
    else { setRows((rs) => rs.filter((x) => x.id !== id)); toast.success("تم تسجيل التعويض كمسودّة قيد"); }
    setBusy(null);
  });

  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد تعويضات بانتظار التسجيل ✓</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        تعويضات من المنصة عن مخزون ضائع/تالف. «سجّل» بيعمل <b>قيد يومية مسودّة</b> (مدين المحفظة / دائن تعويضات المنصات 4103) يراجعه المحاسب ويرحّله — عشان ماتتكرّرش مع التسوية. التعويض العيني (وحدات) بيتعرض وترجّعه من أوامر السحب/التسويات.
      </p>
      {rows.map((o) => {
        const isBusy = pending && busy === o.id;
        return (
          <Card key={o.id}>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm" dir="ltr">{o.reimbursementId}</span>
                  {o.orderId && <span className="text-xs text-muted-foreground" dir="ltr">طلب {o.orderId}</span>}
                  <span className="text-xs text-muted-foreground">· {dt(o.approvalDate)}</span>
                  {o.reason && <Badge variant="outline">{o.reason}</Badge>}
                  {o.matchedLoss && <Badge variant="secondary" className="gap-1"><Link2 className="size-3" />{o.matchedLoss}</Badge>}
                </div>
                <div className="text-sm">
                  {o.sku && <span dir="ltr">{o.sku} · </span>}
                  <span className="font-semibold">{fmt(o.amountTotal)} {o.currency ?? ""}</span>
                  {o.qtyInv > 0 && <span className="text-muted-foreground"> · عيني {o.qtyInv} وحدة</span>}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={isBusy} onClick={() => confirm(o.id)}>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : <HandCoins className="size-4 text-emerald-600" />}سجّل
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
