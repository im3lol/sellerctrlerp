"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { PackageCheck, PackageX, XCircle, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { confirmRemovalAction, type RemovalOutcome } from "@/app/actions/erp/platform-removals";
import type { PlatformRemovalRow } from "@/lib/erp/removals-core";

const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString("ar-EG-u-nu-latn", { dateStyle: "short" }) : "—");

/**
 * The trader's decision on each synced removal order (stock out of the FBA warehouse):
 *  • استلمته  → restock the units shipped back (delta +shipped, DRAFT تسوية مخزون)
 *  • اتلف     → write off the destroyed units (delta −disposed)
 *  • تجاهل    → nothing to book
 * Never a revenue reversal — a removal isn't a customer return.
 */
export function MarketplaceRemovalsClient({ initial }: { initial: PlatformRemovalRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const act = (id: string, outcome: RemovalOutcome) => start(async () => {
    setBusy(id);
    const r = await confirmRemovalAction(id, outcome);
    if ("error" in r) toast.error(r.error);
    else { setRows((rs) => rs.filter((x) => x.id !== id)); toast.success(outcome === "IGNORE" ? "تم التجاهل" : "تمّت المعالجة"); }
    setBusy(null);
  });

  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد أوامر سحب بانتظار المراجعة ✓</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        دي أوامر سحب من المنصة (ركود/عيب/بطلبك) — مش مرتجعات عملاء. أكّد لكل واحد: استلمت الراجع للمخزن، ولا اتلف. بيتعمل <b>تسوية مخزون مسودّة</b> يراجعها المحاسب ويرحّلها.
      </p>
      {rows.map((o) => {
        const isBusy = pending && busy === o.id;
        return (
          <Card key={o.id}>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{o.channel}</Badge>
                  {o.orderType && <Badge variant="outline">{o.orderType}</Badge>}
                  <span className="font-mono text-sm" dir="ltr">{o.removalOrderId}</span>
                  <span className="text-xs text-muted-foreground">· {dt(o.requestDate)}</span>
                </div>
                <div className="text-sm">
                  <span dir="ltr">{o.sku}</span>
                  {o.disposition && <span className="text-muted-foreground"> · {o.disposition}</span>}
                  <span className="text-muted-foreground"> · راجع {o.shippedQty} · متلَف {o.disposedQty}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {o.shippedQty > 0 && (
                  <Button size="sm" variant="outline" disabled={isBusy} onClick={() => act(o.id, "RECEIVED")}>
                    {isBusy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4 text-emerald-600" />}استلمت {o.shippedQty}
                  </Button>
                )}
                {o.disposedQty > 0 && (
                  <Button size="sm" variant="outline" disabled={isBusy} onClick={() => act(o.id, "DISPOSED")}>
                    <PackageX className="size-4 text-red-600" />إتلاف {o.disposedQty}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => act(o.id, "IGNORE")}>
                  <XCircle className="size-4 text-muted-foreground" />تجاهل
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
