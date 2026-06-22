"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { searchItemsAction } from "@/app/actions/erp/item-search";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Option = { id: string; code: string; name: string };
type Stock = { itemId: string; warehouseId: string; quantity: number };
type Line = { key: number; itemId: string; itemLabel: string; fromWh: string; toWh: string; quantity: string };

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function TransferForm({
  orgName,
  items,
  warehouses,
  stock,
}: {
  orgName: string;
  items: Option[];
  warehouses: Option[];
  stock: Stock[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const defFrom = warehouses[0]?.id ?? "";
  const defTo = warehouses[1]?.id ?? warehouses[0]?.id ?? "";
  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: "", itemLabel: "", fromWh: defFrom, toWh: defTo, quantity: "" }]);
  const nextKey = (ls: Line[]) => ls.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) m.set(`${s.itemId}|${s.warehouseId}`, s.quantity);
    return m;
  }, [stock]);
  const available = (l: Line) => stockMap.get(`${l.itemId}|${l.fromWh}`) ?? 0;

  const itemOptions = useMemo(() => items.map((i) => ({ id: i.id, label: `${i.code} — ${i.name}`, hint: i.code })), [items]);
  const whOptions = useMemo(() => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code })), [warehouses]);
  const whLabel = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "";

  const addLine = (itemId = "", itemLabel = "") =>
    setLines((ls) => [...ls, { key: nextKey(ls), itemId, itemLabel, fromWh: defFrom, toWh: defTo, quantity: "" }]);
  const updateLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: number) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));

  const onScan = async (raw: string) => {
    const term = raw.trim();
    if (!term) return;
    setScanning(true);
    try {
      const results = await searchItemsAction(term);
      if (results.length === 0) { toast.error(`لا يوجد صنف بالكود ${term}`); return; }
      const it = results[0];
      const label = `${it.code} — ${it.name}`;
      setLines((ls) => {
        const empty = ls.find((l) => !l.itemId);
        if (empty) return ls.map((l) => (l.key === empty.key ? { ...l, itemId: it.id, itemLabel: label } : l));
        return [...ls, { key: nextKey(ls), itemId: it.id, itemLabel: label, fromWh: defFrom, toWh: defTo, quantity: "" }];
      });
      setBarcode("");
    } finally {
      setScanning(false);
    }
  };

  const submit = () =>
    start(async () => {
      const ready = lines.filter((l) => l.itemId && Number(l.quantity) > 0);
      if (ready.length === 0) { toast.error("أضف صنفاً واحداً على الأقل بكمية"); return; }
      for (const l of ready) {
        if (l.fromWh === l.toWh) { toast.error("المستودع المصدر والوجهة متماثلان في أحد الأصناف"); return; }
        if (Number(l.quantity) > available(l) + 1e-9) { toast.error(`الكمية أكبر من المتاح للصنف ${l.itemLabel}`); return; }
      }
      const r = await createStockTransferAction({
        date, notes,
        lines: ready.map((l) => ({ itemId: l.itemId, fromWarehouseId: l.fromWh, toWarehouseId: l.toWh, quantity: Number(l.quantity) })),
      });
      if (r.ok) { toast.success("تم حفظ التحويل (مسودة) — أكّده للترحيل"); router.push("/erp/inventory/transfers"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>بيانات التحويل</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">تاريخ التحويل</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الأصناف</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="barcode">باركود / مسح سريع</Label>
              <Input
                id="barcode"
                value={barcode}
                disabled={scanning}
                placeholder="امسح الباركود ثم Enter…"
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onScan(barcode); } }}
                className="w-64"
              />
            </div>
            <Button type="button" variant="outline" onClick={() => addLine()}><Icon name="Plus" className="size-4" />إضافة سطر</Button>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" dir="rtl">
              <thead className="bg-muted/50 text-muted-foreground text-xs">
                <tr>
                  <th className="px-3 py-2 text-right font-medium min-w-56">اسم الصنف</th>
                  <th className="px-3 py-2 text-right font-medium">من مستودع</th>
                  <th className="px-3 py-2 text-right font-medium">إلى مستودع</th>
                  <th className="px-3 py-2 text-right font-medium">المتاح</th>
                  <th className="px-3 py-2 text-right font-medium">الكمية</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l) => {
                  const avail = available(l);
                  const over = l.itemId && Number(l.quantity) > avail + 1e-9;
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="px-2 py-2">
                        <CellCombobox selectedLabel={l.itemLabel} options={itemOptions} placeholder="ابحث بالاسم أو الكود…"
                          onSelect={(id, label) => updateLine(l.key, { itemId: id, itemLabel: label })} />
                      </td>
                      <td className="px-2 py-2">
                        <CellCombobox selectedLabel={whLabel(l.fromWh)} options={whOptions} placeholder="من…"
                          onSelect={(id) => updateLine(l.key, { fromWh: id })} />
                      </td>
                      <td className="px-2 py-2">
                        <CellCombobox selectedLabel={whLabel(l.toWh)} options={whOptions} placeholder="إلى…"
                          onSelect={(id) => updateLine(l.key, { toWh: id })} />
                      </td>
                      <td className="px-2 py-2"><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{l.itemId ? q(avail) : "—"}</div></td>
                      <td className="px-2 py-2"><Input type="number" step="0.001" min="0" className={`w-28 ${over ? "border-destructive text-destructive" : ""}`} value={l.quantity} onChange={(e) => updateLine(l.key, { quantity: e.target.value })} /></td>
                      <td className="px-2 py-2 text-center">
                        <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.key)} aria-label="حذف"><Icon name="Trash2" className="size-4 text-destructive" /></Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <Button disabled={pending} onClick={submit}>حفظ التحويل (مسودة)</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
