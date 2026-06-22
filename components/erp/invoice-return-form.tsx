"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSalesReturnAction, createDeliveryReturnAction } from "@/app/actions/erp/sales-returns";
import { createPurchaseReturnAction, createReceiptReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ReturnLine = { itemId: string; code: string; name: string; invoiced: number; returned: number; remaining: number; unitPrice: number };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const round2 = (n: number) => Math.round(n * 100) / 100;

export function InvoiceReturnForm({
  type, invoiceId, invoiceNumber, backHref, lines,
}: {
  type: "sales" | "purchase" | "receipt" | "delivery";
  invoiceId: string;
  invoiceNumber: string;
  backHref: string;
  lines: ReturnLine[];
}) {
  const docLabel = type === "receipt" ? "إذن استلام" : type === "delivery" ? "إذن صرف" : "فاتورة";
  const qtyLabel = type === "receipt" ? "المستلم" : type === "delivery" ? "المُسلّم" : "المفوتر";
  const salesSide = type === "sales" || type === "delivery";
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [qtys, setQtys] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.itemId, ""])));

  const total = useMemo(
    () => round2(lines.reduce((s, l) => s + (Number(qtys[l.itemId]) || 0) * l.unitPrice, 0)),
    [qtys, lines],
  );

  const submit = () => {
    const picks = lines
      .map((l) => ({ itemId: l.itemId, quantity: Number(qtys[l.itemId]) || 0, unitPrice: l.unitPrice }))
      .filter((p) => p.quantity > 0);
    if (picks.length === 0) return toast.error("حدّد كمية مرتجعة لبند واحد على الأقل");
    if (lines.some((l) => (Number(qtys[l.itemId]) || 0) > l.remaining + 1e-6)) return toast.error("الكمية المرتجعة أكبر من المتبقّي");
    start(async () => {
      const r = type === "sales" ? await createSalesReturnAction({ salesInvoiceId: invoiceId, date, lines: picks })
        : type === "delivery" ? await createDeliveryReturnAction({ deliveryNoteId: invoiceId, date, lines: picks })
        : type === "receipt" ? await createReceiptReturnAction({ goodsReceiptId: invoiceId, date, lines: picks })
        : await createPurchaseReturnAction({ purchaseInvoiceId: invoiceId, date, lines: picks });
      if (r.ok) {
        toast.success("تم حفظ المرتجع (مسودة) — أكّده");
        router.push(`/erp/${salesSide ? "sales" : "purchases"}/returns/${r.id}`);
        router.refresh();
      } else toast.error(r.error ?? "تعذّر حفظ المرتجع");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>مرتجع من {docLabel} {invoiceNumber}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ المرتجع</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(backHref)}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2"><Label>تاريخ المرتجع</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="w-24 text-start">{qtyLabel}</TableHead>
                <TableHead className="w-24 text-start">المرتجع سابقاً</TableHead>
                <TableHead className="w-24 text-start">المتبقّي</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-32 text-start">كمية المرتجع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>{qtyf(l.invoiced)}</TableCell>
                  <TableCell className="text-muted-foreground">{qtyf(l.returned)}</TableCell>
                  <TableCell className={l.remaining > 0 ? "font-medium" : "text-muted-foreground"}>{qtyf(l.remaining)}</TableCell>
                  <TableCell>{fmt(l.unitPrice)}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.001" min="0" max={l.remaining} disabled={l.remaining <= 0}
                      value={qtys[l.itemId] ?? ""} onChange={(e) => setQtys((p) => ({ ...p, [l.itemId]: e.target.value }))} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex justify-end text-sm">
          <div className="text-base font-bold text-primary">إجمالي المرتجع (قبل الضريبة): {fmt(total)}</div>
        </div>
      </CardContent>
    </Card>
  );
}
