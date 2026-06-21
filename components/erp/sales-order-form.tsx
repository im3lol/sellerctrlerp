"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemCombobox } from "@/components/erp/item-combobox";
import { ItemPicker } from "@/components/erp/item-picker";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null };
type Line = { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newLine = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, discountAmount: 0, taxAmount: 0 });

export function SalesOrderForm({ customers, items }: { customers: Customer[]; items: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(today);
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const addOrBumpItem = (item: ItemSearchResult) =>
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) return ls.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      const line: Line = { itemId: item.id, quantity: 1, unitPrice: item.sellPrice || 0, discountAmount: 0, taxAmount: 0 };
      const emptyIdx = ls.findIndex((l) => !l.itemId);
      if (emptyIdx >= 0) return ls.map((l, i) => (i === emptyIdx ? line : l));
      return [...ls, line];
    });

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
    const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
  }, [lines]);

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const r = await createSalesOrderAction({ customerId, date, dueDate: dueDate || undefined, notes, lines });
      if (r.ok) { toast.success("تم إنشاء أمر البيع"); router.push("/erp/sales/orders"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader><CardTitle>بيانات أمر البيع</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>العميل</Label>
            <select className={selectCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— اختر —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>تاريخ التسليم</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
          <div className="space-y-2"><Label>بحث وإضافة صنف</Label><ItemCombobox onSelect={addOrBumpItem} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-28 text-start">خصم</TableHead>
                <TableHead className="w-28 text-start">ضريبة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => setLine(i, { itemId: it.id, unitPrice: it.sellPrice || l.unitPrice })} />
                  </TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.taxAmount} onChange={(e) => setLine(i, { taxAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell className="font-medium">{fmt(round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount))}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>

        <div className="flex flex-col items-end gap-1 text-sm">
          <div>الإجمالي الفرعي: <span className="font-medium">{fmt(totals.subtotal)}</span></div>
          <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
          <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
          <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)}</div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => router.push("/erp/sales/orders")}>إلغاء</Button>
          <Button onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الأمر</Button>
        </div>
      </CardContent>
    </Card>
  );
}
