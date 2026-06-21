"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { getItemWarehouseStockAction, type WarehouseStock } from "@/app/actions/erp/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null };
type Line = { itemId: string; warehouseId: string; stock: WarehouseStock[]; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const newLine = (): Line => ({ itemId: "", warehouseId: "", stock: [], quantity: 1, unitPrice: 0, discountAmount: 0, taxAmount: 0 });

export function SalesOrderForm({ customers, items, orgName }: { customers: Customer[]; items: Item[]; orgName: string }) {
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

  // On item select: set price, then load on-hand per warehouse and default to the most-stocked one.
  const pickItem = (i: number, item: ItemSearchResult) => {
    setLine(i, { itemId: item.id, unitPrice: Number(item.sellPrice) || 0, stock: [], warehouseId: "" });
    getItemWarehouseStockAction(item.id).then((r) => {
      if (!r.ok || !r.stock) return;
      const stocked = r.stock.filter((s) => s.qty > 0).sort((a, b) => b.qty - a.qty);
      const def = (stocked[0] ?? r.stock[0])?.warehouseId ?? "";
      setLine(i, { stock: r.stock, warehouseId: def });
    });
  };

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
    const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const qty = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    return { subtotal, discount, tax, qty, total: round2(subtotal - discount + tax) };
  }, [lines]);

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const r = await createSalesOrderAction({
        customerId, date, dueDate: dueDate || undefined, notes,
        lines: lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxAmount: l.taxAmount })),
      });
      if (r.ok) { toast.success("تم إنشاء أمر البيع"); router.push("/erp/sales/orders"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات أمر البيع</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الأمر</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/erp/sales/orders")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>العميل</Label>
            <select className={selectCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— اختر —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>تاريخ التسليم</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
        </div>
        <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="w-48 text-start">المستودع</TableHead>
                <TableHead className="w-24 text-start">المخزون الحالي</TableHead>
                <TableHead className="w-20 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-24 text-start">خصم</TableHead>
                <TableHead className="w-24 text-start">ضريبة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => {
                const opts = l.stock.filter((s) => s.qty > 0);
                const whOpts = opts.length ? opts : l.stock;
                const onHand = l.stock.find((s) => s.warehouseId === l.warehouseId)?.qty ?? 0;
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => pickItem(i, it)} />
                    </TableCell>
                    <TableCell>
                      <select className={selectCls} value={l.warehouseId} disabled={!l.itemId} onChange={(e) => setLine(i, { warehouseId: e.target.value })}>
                        {!l.itemId && <option value="">— اختر الصنف —</option>}
                        {l.itemId && whOpts.length === 0 && <option value="">لا يوجد مستودع</option>}
                        {whOpts.map((w) => <option key={w.warehouseId} value={w.warehouseId}>{w.name} — {qtyf(w.qty)}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className={`tabular-nums ${onHand <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{l.itemId ? qtyf(onHand) : "—"}</TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" value={l.taxAmount} onChange={(e) => setLine(i, { taxAmount: Number(e.target.value) })} /></TableCell>
                    <TableCell className="font-medium">{fmt(round2(l.quantity * l.unitPrice - l.discountAmount + l.taxAmount))}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>

        <div className="flex items-start justify-between gap-4 text-sm">
          <div className="flex flex-col items-start gap-1">
            <div>إجمالي الكمية: <span className="font-medium">{qtyf(totals.qty)}</span></div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div>الإجمالي الفرعي: <span className="font-medium">{fmt(totals.subtotal)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
