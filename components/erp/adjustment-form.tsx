"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { searchItemsAction } from "@/app/actions/erp/item-search";
import { ItemPicker } from "@/components/erp/item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Option = { id: string; code: string; name: string };
type Stock = { itemId: string; warehouseId: string; quantity: number; avgCost: number };
type Line = { key: number; itemId: string; itemLabel: string; warehouseId: string; counted: string; unitCost: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AdjustmentForm({
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
  const [reason, setReason] = useState("");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const defaultWh = warehouses[0]?.id ?? "";
  const [lines, setLines] = useState<Line[]>([{ key: 1, itemId: "", itemLabel: "", warehouseId: defaultWh, counted: "", unitCost: "" }]);
  const nextKey = (ls: Line[]) => ls.reduce((m, l) => Math.max(m, l.key), 0) + 1;

  const stockMap = useMemo(() => {
    const m = new Map<string, { quantity: number; avgCost: number }>();
    for (const s of stock) m.set(`${s.itemId}|${s.warehouseId}`, { quantity: s.quantity, avgCost: s.avgCost });
    return m;
  }, [stock]);
  const currentQty = (l: Line) => stockMap.get(`${l.itemId}|${l.warehouseId}`)?.quantity ?? 0;
  const currentCost = (l: Line) => stockMap.get(`${l.itemId}|${l.warehouseId}`)?.avgCost ?? 0;

  const addLine = (itemId = "", itemLabel = "") =>
    setLines((ls) => [...ls, { key: nextKey(ls), itemId, itemLabel, warehouseId: defaultWh, counted: "", unitCost: "" }]);
  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
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
      // Merge into an existing empty line if present, else append.
      setLines((ls) => {
        const empty = ls.find((l) => !l.itemId);
        if (empty) return ls.map((l) => (l.key === empty.key ? { ...l, itemId: it.id, itemLabel: label } : l));
        return [...ls, { key: nextKey(ls), itemId: it.id, itemLabel: label, warehouseId: defaultWh, counted: "", unitCost: "" }];
      });
      setBarcode("");
    } finally {
      setScanning(false);
    }
  };

  const submit = () =>
    start(async () => {
      if (!reason.trim()) { toast.error("اكتب وصف/سبب التسوية"); return; }
      const ready = lines.filter((l) => l.itemId && l.counted !== "");
      if (ready.length === 0) { toast.error("أضف صنفاً واحداً على الأقل بكمية فعلية"); return; }
      const payload = {
        date,
        reason,
        lines: ready.map((l) => ({
          itemId: l.itemId,
          warehouseId: l.warehouseId,
          mode: "set" as const,
          value: Number(l.counted),
          unitCost: l.unitCost ? Number(l.unitCost) : undefined,
        })),
      };
      const r = await createStockAdjustmentAction(payload);
      if (r.ok) { toast.success("تم حفظ التسوية (مسودة) — أكّدها للترحيل"); router.push("/erp/inventory/adjustments"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader><CardTitle>بيانات التسوية</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">تاريخ التسوية</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reason">وصف / سبب التسوية</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: فرق جرد فعلي / تالف / فاقد" />
          </div>
        </CardContent>
      </Card>

      {/* Lines */}
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
                  <th className="px-3 py-2 text-right font-medium">المخزن</th>
                  <th className="px-3 py-2 text-right font-medium">الكمية الحالية</th>
                  <th className="px-3 py-2 text-right font-medium">التكلفة الحالية</th>
                  <th className="px-3 py-2 text-right font-medium">الكمية الفعلية</th>
                  <th className="px-3 py-2 text-right font-medium">السعر</th>
                  <th className="px-3 py-2 text-right font-medium">الفرق</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {lines.map((l) => {
                  const cur = currentQty(l);
                  const delta = (Number(l.counted) || 0) - cur;
                  const hasCount = l.counted !== "";
                  return (
                    <tr key={l.key} className="align-top">
                      <td className="px-2 py-2">
                        <ItemPicker selectedLabel={l.itemLabel} onSelect={(it) => updateLine(l.key, { itemId: it.id, itemLabel: `${it.code} — ${it.name}` })} />
                      </td>
                      <td className="px-2 py-2">
                        <select className={`${selectCls} min-w-36`} value={l.warehouseId} onChange={(e) => updateLine(l.key, { warehouseId: e.target.value })}>
                          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-2"><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{q(cur)}</div></td>
                      <td className="px-2 py-2"><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{l.itemId ? money(currentCost(l)) : "—"}</div></td>
                      <td className="px-2 py-2"><Input type="number" step="0.001" className="w-28" value={l.counted} onChange={(e) => updateLine(l.key, { counted: e.target.value })} /></td>
                      <td className="px-2 py-2"><Input type="number" step="0.01" min="0" className="w-28" value={l.unitCost} onChange={(e) => updateLine(l.key, { unitCost: e.target.value })} placeholder={delta > 0 && cur === 0 ? "مطلوب" : "تلقائي"} /></td>
                      <td className="px-2 py-2">
                        <div className={`flex h-9 items-center px-2 text-sm font-bold ${!hasCount ? "text-muted-foreground" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : ""}`}>
                          {hasCount ? `${delta > 0 ? "+" : ""}${q(delta)}` : "—"}
                        </div>
                      </td>
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
            <Button disabled={pending} onClick={submit}>حفظ التسوية (مسودة)</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
