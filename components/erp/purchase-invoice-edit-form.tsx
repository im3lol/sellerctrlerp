"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updatePurchaseInvoiceAction } from "@/app/actions/erp/purchase-invoices";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";

export type EditLine = {
  itemId: string; code: string; name: string;
  quantity: number; unitPrice: number; shippingPerUnit: number; discountAmount: number; taxAmount: number;
};

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Match the draft to the supplier's actual bill. Quantity and shipping are locked —
 * they describe goods that already entered stock; only price and tax can move, and the
 * difference is settled as a price variance when the invoice is posted.
 */
export function PurchaseInvoiceEditForm({
  invoiceId, number, receiptNumber, initialLines, initialNotes, grniAmount,
}: {
  invoiceId: string; number: string; receiptNumber: string | null;
  initialLines: EditLine[]; initialNotes: string; grniAmount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState(initialLines);
  const [notes, setNotes] = useState(initialNotes);

  const setLine = (itemId: string, patch: Partial<EditLine>) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));

  const totals = useMemo(() => {
    const subtotal = r2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const shipping = r2(lines.reduce((s, l) => s + l.quantity * l.shippingPerUnit, 0));
    const discount = r2(lines.reduce((s, l) => s + l.discountAmount, 0));
    const tax = r2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const net = r2(subtotal + shipping - discount);
    return { subtotal, shipping, discount, tax, net, total: r2(net + tax), variance: r2(net - grniAmount) };
  }, [lines, grniAmount]);

  const submit = () =>
    start(async () => {
      const r = await updatePurchaseInvoiceAction(invoiceId, {
        notes,
        lines: lines.map((l) => ({ itemId: l.itemId, unitPrice: l.unitPrice, taxAmount: l.taxAmount })),
      });
      if (r.ok) {
        toast.success("تم حفظ التعديلات");
        router.push(`/purchases/invoices/${encodeURIComponent(number)}`);
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <CardTitle>تعديل فاتورة {number}</CardTitle>
            <CardDescription>
              طابِق الفاتورة على ما أرسله المورّد فعلياً. الكمية والشحن مقفولان — جايين من إذن الاستلام
              {receiptNumber ? ` ${receiptNumber}` : ""}.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ التعديلات</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/purchases/invoices/${encodeURIComponent(number)}`)}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-32 text-start">سعر الوحدة</TableHead>
                <TableHead className="w-24 text-start">شحن/وحدة</TableHead>
                <TableHead className="w-24 text-start">الخصم</TableHead>
                <TableHead className="w-32 text-start">الضريبة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <PaginatedTableRows rows={lines.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell className="max-w-[22rem] whitespace-normal">
                    <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{l.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.code}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">{qtyf(l.quantity)}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" min="0" value={l.unitPrice}
                      onChange={(e) => setLine(l.itemId, { unitPrice: Number(e.target.value) || 0 })} />
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{fmt(l.shippingPerUnit)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{fmt(l.discountAmount)}</TableCell>
                  <TableCell>
                    <Input type="number" step="0.01" min="0" value={l.taxAmount}
                      onChange={(e) => setLine(l.itemId, { taxAmount: Number(e.target.value) || 0 })} />
                  </TableCell>
                  <TableCell className="font-medium tabular-nums">
                    {fmt(r2(l.quantity * l.unitPrice + l.quantity * l.shippingPerUnit - l.discountAmount + l.taxAmount))}
                  </TableCell>
                </TableRow>
              ))} />
            </TableBody>
          </Table>
        </div>

        <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>

        <div className="flex flex-col items-end gap-1 text-sm">
          <div>الإجمالي الفرعي: <span className="font-medium">{fmt(totals.subtotal)}</span></div>
          <div>الشحن: <span className="font-medium">{fmt(totals.shipping)}</span></div>
          <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
          <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
          <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)}</div>
          <div className="mt-2 rounded-lg border bg-muted/30 px-3 py-2">
            <div>قيمة البضاعة عند الاستلام: <span className="font-medium">{fmt(grniAmount)}</span></div>
            <div className={Math.abs(totals.variance) > 0.004 ? "font-medium text-amber-600" : "text-muted-foreground"}>
              فرق السعر: {fmt(totals.variance)}
              {Math.abs(totals.variance) > 0.004 && <span className="block text-xs">سيُحمَّل على تكلفة المخزون المتاح، والمُباع منه على تكلفة المبيعات.</span>}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
