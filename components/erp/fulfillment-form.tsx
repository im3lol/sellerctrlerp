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

export type FulfillLine = { itemId: string; code: string; name: string; ordered: number; fulfilled: number; remaining: number };

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
}: {
  type: "delivery" | "receipt";
  orderId: string;
  lines: FulfillLine[];
  dest: string;
}) {
  const router = useRouter();
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
        toast.success(isDelivery ? "تم تسجيل التسليم" : "تم تسجيل الاستلام");
        router.push(dest);
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر التنفيذ");
      }
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isDelivery ? "تسليم أصناف" : "استلام أصناف"}</CardTitle>
        <CardDescription>أدخل الكمية {isDelivery ? "المسلّمة" : "المستلمة"} الآن لكل بند — يبقى المتبقّي مفتوحاً على الأمر (Backorder).</CardDescription>
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
                <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push(dest)}>إلغاء</Button>
          <Button disabled={pending} onClick={submit}>{isDelivery ? "تأكيد التسليم" : "تأكيد الاستلام"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
