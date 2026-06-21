"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createPurchaseOrderAction } from "@/app/actions/erp/purchase-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";

type Supplier = { id: string; nameAr: string };
type Warehouse = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null };
type Line = { itemId: string; quantity: number; unitPrice: number; shippingPerUnit: number; discountPerUnit: number; taxAmount: number };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const lineTotal = (l: Line) => round2(l.quantity * l.unitPrice + l.quantity * l.shippingPerUnit - l.quantity * l.discountPerUnit + l.taxAmount);
const newLine = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, shippingPerUnit: 0, discountPerUnit: 0, taxAmount: 0 });

export function PurchaseOrderForm({ suppliers, warehouses, items, orgName }: { suppliers: Supplier[]; warehouses: Warehouse[]; items: Item[]; orgName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const addOrBumpItem = (item: ItemSearchResult) =>
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) return ls.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      const line: Line = { itemId: item.id, quantity: 1, unitPrice: 0, shippingPerUnit: 0, discountPerUnit: 0, taxAmount: 0 };
      const emptyIdx = ls.findIndex((l) => !l.itemId);
      if (emptyIdx >= 0) return ls.map((l, i) => (i === emptyIdx ? line : l));
      return [...ls, line];
    });

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const shipping = round2(lines.reduce((s, l) => s + l.quantity * l.shippingPerUnit, 0));
    const discount = round2(lines.reduce((s, l) => s + l.quantity * l.discountPerUnit, 0));
    const tax = round2(lines.reduce((s, l) => s + l.taxAmount, 0));
    const qty = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    return { subtotal, shipping, discount, tax, qty, total: round2(subtotal + shipping - discount + tax) };
  }, [lines]);

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!warehouseId) return toast.error("اختر المستودع");
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const payload = lines.map((l) => ({
        itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, shippingPerUnit: l.shippingPerUnit,
        taxAmount: l.taxAmount, discountAmount: round2(l.quantity * l.discountPerUnit),
      }));
      const r = await createPurchaseOrderAction({ supplierId, warehouseId, date, notes, lines: payload });
      if (r.ok) {
        toast.success("تم حفظ أمر الشراء (مسودة) — أكّده أو ألغِه");
        router.push(r.id ? `/erp/purchases/orders/${r.id}` : "/erp/purchases/orders");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>بيانات أمر الشراء</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => router.push("/erp/purchases/orders")}>إلغاء</Button>
          <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الأمر</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>المورد</Label>
            <select className={selectCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— اختر —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
          <div className="space-y-2">
            <Label>المستودع</Label>
            <select className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-28 text-start">خصم/وحدة</TableHead>
                <TableHead className="w-28 text-start">ضريبة</TableHead>
                <TableHead className="w-28 text-start">شحن/وحدة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => setLine(i, { itemId: it.id })} />
                  </TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.discountPerUnit} onChange={(e) => setLine(i, { discountPerUnit: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.taxAmount} onChange={(e) => setLine(i, { taxAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.shippingPerUnit} onChange={(e) => setLine(i, { shippingPerUnit: Number(e.target.value) })} /></TableCell>
                  <TableCell className="font-medium">{fmt(lineTotal(l))}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
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
            <div>الشحن: <span className="font-medium">{fmt(totals.shipping)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
