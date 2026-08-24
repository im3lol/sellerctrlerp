"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Loader2, PackageCheck, PackageX, HandCoins } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { confirmPlatformReturnAction, type MarketplaceReturnRow } from "@/app/actions/erp/platform-returns";
import type { ReturnReceipt } from "@/lib/erp/return-disposition";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s: string) => new Date(s).toLocaleDateString("ar-EG-u-nu-latn", { dateStyle: "short" });

/**
 * The trader's receipt decision on each marketplace customer return (a DRAFT credit note):
 *  • استلمته سليم  → عكس الفاتورة + إرجاع مخزون قابل للبيع
 *  • استلمته تالف  → عكس الفاتورة + إهلاك الوحدة (مش قابلة للبيع)
 *  • ماستلمتوش    → عكس الفاتورة فقط (المنصة حجزته/أتلفته) — بانتظار تعويض
 * Nothing posts until the trader chooses — a return isn't real till the goods are back.
 */
export function MarketplaceReturnsClient({ initial }: { initial: MarketplaceReturnRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const act = (id: string, receipt: ReturnReceipt) => start(async () => {
    setBusy(id);
    const r = await confirmPlatformReturnAction(id, receipt);
    if ("error" in r) toast.error(r.error);
    else { setRows((rs) => rs.filter((x) => x.id !== id)); toast.success("تمّت المعالجة وترحيلها"); }
    setBusy(null);
  });

  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد مرتجعات منصّات بانتظار المراجعة ✓</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        دي مرتجعات عملاء من المنصات كمسودّات. المرتجع مايترحّلش لحد ما تأكّد إنك <b>استلمت الوحدة فعلًا</b> — العميل بيرجّع للمنصة، والمنصة مش دايمًا ترجّعه لك. اختَر لكل مرتجع:
      </p>
      {rows.map((o) => {
        const isBusy = pending && busy === o.id;
        return (
          <Card key={o.id}>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {o.channel && <Badge variant="secondary">{o.channel}</Badge>}
                  <span className="font-mono text-sm">{o.number}</span>
                  {o.externalReturnId && <span className="text-xs text-muted-foreground" dir="ltr">طلب {o.externalReturnId}</span>}
                  {o.invoiceNumber && <span className="text-xs text-muted-foreground">· فاتورة {o.invoiceNumber}</span>}
                  <span className="text-xs text-muted-foreground">· {dt(o.date)} · {o.customerName ?? "—"}</span>
                </div>
                <div className="text-sm">{o.itemsSummary || "—"} <span className="text-muted-foreground">· الإجمالي {fmt(o.total)}</span></div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" disabled={isBusy} onClick={() => act(o.id, "RECEIVED_SELLABLE")}>
                  {isBusy ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4 text-emerald-600" />}استلمته سليم
                </Button>
                <Button size="sm" variant="outline" disabled={isBusy} onClick={() => act(o.id, "RECEIVED_DAMAGED")}>
                  <PackageX className="size-4 text-amber-600" />استلمته تالف
                </Button>
                <Button size="sm" variant="outline" disabled={isBusy} onClick={() => act(o.id, "NOT_RECEIVED")}>
                  <HandCoins className="size-4 text-muted-foreground" />ماستلمتوش
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
