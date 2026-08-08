"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Loader2, PackagePlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { resolveUnmatchedAction, type UnmatchedOrder } from "@/app/actions/erp/unmatched-orders";

const fmt = (n: number) => Number(n || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (s: string) => new Date(s).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

/**
 * The parked marketplace orders whose product isn't in the catalog. For each, the seller
 * creates the product (linking its platform codes) then the order — the system never
 * auto-creates. Once the product's code exists, the next sync clears it automatically;
 * "تمّت المعالجة" dismisses it now.
 */
export function UnmatchedOrdersClient({ initial }: { initial: UnmatchedOrder[] }) {
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  const resolve = (id: string) => start(async () => {
    setBusy(id);
    const r = await resolveUnmatchedAction(id);
    if (r.ok) { setRows((rs) => rs.filter((x) => x.id !== id)); toast.success("تمّت المعالجة"); }
    else toast.error(r.error);
    setBusy(null);
  });

  if (rows.length === 0) {
    return <Card><CardContent className="py-10 text-center text-muted-foreground">لا توجد طلبات بمنتجات غير معرَّفة — كله متطابق ✓</CardContent></Card>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        دي طلبات وصلت من المنصات بمنتج مش مربوط بأي صنف. النظام ما بيعملهاش تلقائيًا. لكل طلب: اعمل الصنف واربط بيه أكواد المنصة، بعدها الطلب هيتسجّل في المزامنة الجاية (أو «تمّت المعالجة» لتجاهله).
      </p>
      {rows.map((o) => (
        <Card key={o.id}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Badge variant="secondary">{o.channel}</Badge>
                <span dir="ltr" className="font-mono">{o.externalId}</span>
                <span className="text-sm font-normal text-muted-foreground">· {dt(o.createdAt)} · الإجمالي {fmt(o.total)}</span>
              </CardTitle>
              <Button size="sm" variant="outline" onClick={() => resolve(o.id)} disabled={pending && busy === o.id}>
                {pending && busy === o.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}تمّت المعالجة
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {o.lines.map((l, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border px-3 py-2 text-sm ${l.matched ? "" : "border-destructive/40 bg-destructive/5"}`}>
                <span className="font-medium">{l.name || l.code}</span>
                <span className="text-muted-foreground" dir="ltr">SKU: {l.code}</span>
                {l.altCode && <span className="text-muted-foreground" dir="ltr">ASIN: {l.altCode}</span>}
                <span className="text-muted-foreground">الكمية {l.qty} × {fmt(l.unitPrice)}</span>
                {!l.matched && (
                  <Button asChild size="sm" variant="ghost" className="ms-auto h-7 text-primary">
                    <Link href={`/inventory/items/new?code=${encodeURIComponent(l.code)}${l.altCode ? `&asin=${encodeURIComponent(l.altCode)}` : ""}`}>
                      <PackagePlus className="size-3.5" />أنشئ المنتج
                    </Link>
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
