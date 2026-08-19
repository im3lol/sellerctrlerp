"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createQuotationAction, updateQuotationAction } from "@/app/actions/erp/quotations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import { ItemThumb } from "@/components/erp/item-thumb";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import { CellCombobox } from "@/components/erp/cell-combobox";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { lineVat } from "@/lib/erp/vat";

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null; code?: string | null; image?: string | null };
type Line = { itemId: string; quantity: number; unitPrice: number; discountAmount: number; exempt: boolean };

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const newLine = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, discountAmount: 0, exempt: false });
const lineTotal = (l: Line, vatRate: number) => round2(l.quantity * l.unitPrice - l.discountAmount + lineVat(l.quantity, l.unitPrice, l.discountAmount, vatRate, l.exempt));

export type QuotationInitial = { id: string; customerId: string; date: string; validUntil: string; notes: string; lines: Line[] };

export function QuotationForm({ customers, items, orgName, vatRate, initial }: { customers: Customer[]; items: Item[]; orgName: string; vatRate: number; initial?: QuotationInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;
  const [customerId, setCustomerId] = useState(initial?.customerId ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [validUntil, setValidUntil] = useState(initial?.validUntil ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines?.length ? initial.lines : [newLine()]);

  const custOptions = useMemo(() => customers.map((c) => ({ id: c.id, label: c.nameAr })), [customers]);
  const custLabel = useMemo(() => new Map(custOptions.map((o) => [o.id, o.label])), [custOptions]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  const pickItem = (i: number, it: ItemSearchResult) => setLine(i, { itemId: it.id, unitPrice: Number(it.sellPrice) || 0 });

  const addOrBumpItem = (item: ItemSearchResult) => {
    const idx = lines.findIndex((l) => l.itemId === item.id);
    if (idx >= 0) { setLine(idx, { quantity: lines[idx].quantity + 1 }); return; }
    const empty = lines.findIndex((l) => !l.itemId);
    if (empty >= 0) { pickItem(empty, item); return; }
    setLines((ls) => [...ls, newLine()]);
    pickItem(lines.length, item);
  };

  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const discount = round2(lines.reduce((s, l) => s + l.discountAmount, 0));
    const tax = round2(lines.reduce((s, l) => s + lineVat(l.quantity, l.unitPrice, l.discountAmount, vatRate, l.exempt), 0));
    return { subtotal, discount, tax, total: round2(subtotal - discount + tax) };
  }, [lines, vatRate]);

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const body = { customerId, date, validUntil: validUntil || undefined, notes, lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxAmount: lineVat(l.quantity, l.unitPrice, l.discountAmount, vatRate, l.exempt), exempt: l.exempt })) };
      const r = isEdit ? await updateQuotationAction(initial!.id, body) : await createQuotationAction(body);
      if (r.ok) { toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ عرض السعر (مسودة)"); router.push(r.id ? `/sales/quotations/${r.id}` : "/sales/quotations"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات عرض السعر</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{isEdit ? "حفظ التعديلات" : "حفظ العرض"}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(isEdit ? `/sales/quotations/${initial!.id}` : "/sales/quotations")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2"><Label>الشركة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>العميل</Label><CellCombobox selectedLabel={custLabel.get(customerId) ?? ""} options={custOptions} onSelect={setCustomerId} placeholder="ابحث عن العميل…" /></div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>صالح حتى</Label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
          <div className="space-y-2 sm:col-span-2"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="w-14 text-start">صورة</TableHead>
              <TableHead className="w-72 min-w-64 text-start">الصنف</TableHead>
              <TableHead className="w-24 text-start">الكمية</TableHead>
              <TableHead className="w-32 text-start">السعر</TableHead>
              <TableHead className="w-32 text-start">خصم</TableHead>
              <TableHead className="w-40 text-start">{vatRate > 0 ? `ضريبة (${qtyf(vatRate)}%)` : "ضريبة"}</TableHead>
              <TableHead className="w-28 text-start">الإجمالي</TableHead>
              <TableHead className="w-10" />
            </TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><ItemThumb src={itemById.get(l.itemId)?.image} /></TableCell>
                  <TableCell className="min-w-64 max-w-72">
                    <ItemPicker
                      selected={itemById.get(l.itemId) ? { name: itemById.get(l.itemId)!.nameAr ?? "", code: itemById.get(l.itemId)!.code, image: itemById.get(l.itemId)!.image } : null}
                      onSelect={(it) => pickItem(i, it)}
                    />
                  </TableCell>
                  <TableCell><Input type="number" step="1" min="1" className="w-20" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="w-28" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="w-28" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="min-w-[3.5rem] tabular-nums">{fmt(lineVat(l.quantity, l.unitPrice, l.discountAmount, vatRate, l.exempt))}</span>
                      <label className="flex items-center gap-1 whitespace-nowrap text-xs text-muted-foreground"><input type="checkbox" checked={l.exempt} onChange={(e) => setLine(i, { exempt: e.target.checked })} />معفى</label>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{fmt(lineTotal(l, vatRate))}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>

        <div className="flex justify-between gap-4 text-sm">
          <div className="space-y-2 sm:w-1/2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="شروط العرض، مدة التوريد…" /></div>
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
