"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createSalesReturnAction } from "@/app/actions/erp/sales-returns";
import { createPurchaseReturnAction } from "@/app/actions/erp/purchase-returns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type ReturnLine = { itemId: string; name: string; unitPrice: number; maxQty: number };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReturnForm({
  mode,
  invoiceId,
  invoiceNumber,
  lines,
}: {
  mode: "sales" | "purchase";
  invoiceId: string;
  invoiceNumber: string;
  lines: ReturnLine[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isSales = mode === "sales";

  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [qtys, setQtys] = useState<Record<string, string>>({});

  const net = useMemo(
    () => lines.reduce((s, l) => s + (Number(qtys[l.itemId]) || 0) * l.unitPrice, 0),
    [lines, qtys],
  );

  const dest = isSales ? "/erp/sales/returns" : "/erp/purchases/returns";

  const submit = () =>
    start(async () => {
      const picked = lines
        .map((l) => ({ itemId: l.itemId, quantity: Number(qtys[l.itemId]) || 0, unitPrice: l.unitPrice }))
        .filter((l) => l.quantity > 0);
      if (picked.length === 0) { toast.error("حدّد كمية مرتجعة على بند واحد على الأقل"); return; }
      if (lines.some((l) => (Number(qtys[l.itemId]) || 0) > l.maxQty + 1e-9)) {
        toast.error("الكمية المرتجعة أكبر من الأصلية"); return;
      }
      const payload = { date, notes, lines: picked };
      const r = isSales
        ? await createSalesReturnAction({ ...payload, salesInvoiceId: invoiceId })
        : await createPurchaseReturnAction({ ...payload, purchaseInvoiceId: invoiceId });
      if (r.ok) {
        toast.success((isSales ? "تم حفظ مرتجع المبيعات" : "تم حفظ مرتجع المشتريات") + " (مسودة) — أكّده للترحيل");
        router.push(dest);
        router.refresh();
      } else {
        toast.error(r.error ?? "تعذّر الحفظ");
      }
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>بيانات المرتجع — فاتورة {invoiceNumber}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="date">التاريخ</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات / سبب المرتجع</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="سبب الإرجاع" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>البنود</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start">السعر</TableHead>
                <TableHead className="text-start">الكمية الأصلية</TableHead>
                <TableHead className="text-start w-36">كمية الإرجاع</TableHead>
                <TableHead className="text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const q = Number(qtys[l.itemId]) || 0;
                return (
                  <TableRow key={l.itemId}>
                    <TableCell>{l.name}</TableCell>
                    <TableCell>{fmt(l.unitPrice)}</TableCell>
                    <TableCell>{l.maxQty.toLocaleString("ar-EG-u-nu-latn")}</TableCell>
                    <TableCell>
                      <Input
                        type="number" step="0.01" min="0" max={l.maxQty}
                        value={qtys[l.itemId] ?? ""}
                        onChange={(e) => setQtys((p) => ({ ...p, [l.itemId]: e.target.value }))}
                      />
                    </TableCell>
                    <TableCell>{fmt(q * l.unitPrice)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="font-bold">
                <TableCell colSpan={4}>إجمالي المرتجع (قبل الضريبة)</TableCell>
                <TableCell>{fmt(net)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
          <div className="mt-4 flex justify-end">
            <Button disabled={pending || net <= 0} onClick={submit}>
              {isSales ? "حفظ مرتجع مبيعات (مسودة)" : "حفظ مرتجع مشتريات (مسودة)"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
