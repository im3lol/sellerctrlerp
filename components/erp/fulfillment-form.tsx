"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createDeliveryFromOrderAction } from "@/app/actions/erp/deliveries";
import { createReceiptFromOrderAction } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type FulfillLine = { itemId: string; code: string; name: string; ordered: number; fulfilled: number; remaining: number; marketplaceCode?: string };

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * Partial fulfilment entry: one row per order line showing ordered / already
 * done / remaining, with a "now" input defaulted to the remaining quantity.
 * Submitting receives or delivers exactly those quantities (backorder = the
 * rest stays open on the order).
 */
export function FulfillmentForm({
  type,
  orderId,
  lines,
  dest,
  channel,
}: {
  type: "delivery" | "receipt";
  orderId: string;
  lines: FulfillLine[];
  dest: string;
  channel?: string;
}) {
  const router = useRouter();
  const mktLabel = channel === "AMAZON" ? "ASIN" : channel === "NOON" ? "كود نون" : "";
  const [pending, start] = useTransition();
  const [qtys, setQtys] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.itemId, String(l.remaining)])),
  );
  const isDelivery = type === "delivery";

  const submit = () =>
    start(async () => {
      const picks = lines
        .map((l) => ({ itemId: l.itemId, quantity: Number(qtys[l.itemId]) || 0 }))
        .filter((p) => p.quantity > 0);
      if (picks.length === 0) { toast.error("حدّد كمية لبند واحد على الأقل"); return; }
      if (lines.some((l) => (Number(qtys[l.itemId]) || 0) > l.remaining + 1e-6)) {
        toast.error("الكمية أكبر من المتبقّي"); return;
      }
      const r = isDelivery
        ? await createDeliveryFromOrderAction(orderId, picks)
        : await createReceiptFromOrderAction(orderId, picks);
      if (r.ok) {
        // Both are now drafts: land on the new document to confirm.
        toast.success(isDelivery ? "تم حفظ إذن الصرف (مسودة) — أكّده لترحيله" : "تم حفظ إذن الاستلام (مسودة) — أكّده لترحيله");
        const newId = "id" in r ? (r as { id?: string }).id : undefined;
        const base = isDelivery ? "/sales/deliveries" : "/purchases/receipts";
        router.push(newId ? `${base}/${newId}` : dest);
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر التنفيذ");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isDelivery ? "تسليم أصناف" : "استلام أصناف"}</CardTitle>
        <CardDescription>أدخل الكمية {isDelivery ? "المسلّمة" : "المستلمة"} الآن لكل بند — يُحفظ كمسودة ثم تؤكّده من صفحة الإذن؛ ويبقى المتبقّي مفتوحاً على الأمر (Backorder).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">الصنف</TableHead>
              <TableHead className="text-start">المطلوب</TableHead>
              <TableHead className="text-start">{isDelivery ? "مُسلّم سابقاً" : "مُستلم سابقاً"}</TableHead>
              <TableHead className="text-start">المتبقّي</TableHead>
              <TableHead className="text-start w-36">{isDelivery ? "تسليم الآن" : "استلام الآن"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => (
              <TableRow key={l.itemId}>
                <TableCell className="max-w-[22rem] whitespace-normal">
                  <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{l.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
                    <span>{l.code}</span>
                    {l.marketplaceCode && <span dir="ltr">{mktLabel}: {l.marketplaceCode}</span>}
                  </div>
                </TableCell>
                <TableCell>{q(l.ordered)}</TableCell>
                <TableCell>{q(l.fulfilled)}</TableCell>
                <TableCell className={l.remaining > 0 ? "font-medium" : "text-muted-foreground"}>{q(l.remaining)}</TableCell>
                <TableCell>
                  <Input
                    type="number" step="0.001" min="0" max={l.remaining}
                    value={qtys[l.itemId] ?? ""}
                    disabled={l.remaining <= 0}
                    onChange={(e) => setQtys((p) => ({ ...p, [l.itemId]: e.target.value }))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {!isDelivery && (
          <p className="text-xs text-muted-foreground">
            تكاليف الشحن والجمارك تُسجَّل بعد الاستلام من «المشتريات ← تكاليف الاستيراد»، وتُوزَّع هناك على هذا الإذن.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push(dest)}>إلغاء</Button>
          <Button disabled={pending} onClick={submit}>{isDelivery ? "حفظ إذن الصرف" : "حفظ إذن الاستلام"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
