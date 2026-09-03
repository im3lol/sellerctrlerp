"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { searchItemsAction } from "@/app/actions/erp/item-search";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { ItemPicker } from "@/components/erp/item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableLineRows } from "@/components/erp/sortable-line-rows";

type Option = { id: string; code: string; name: string };
type Stock = { itemId: string; warehouseId: string; quantity: number; avgCost: number };
type Line = { id: string; itemId: string; itemLabel: string; warehouseId: string; counted: string; unitCost: string };
const newId = () => crypto.randomUUID();

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AdjustmentForm({
  orgName,
  warehouses,
  stock,
}: {
  orgName: string;
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
  const [lines, setLines] = useState<Line[]>([{ id: newId(), itemId: "", itemLabel: "", warehouseId: defaultWh, counted: "", unitCost: "" }]);

  const stockMap = useMemo(() => {
    const m = new Map<string, { quantity: number; avgCost: number }>();
    for (const s of stock) m.set(`${s.itemId}|${s.warehouseId}`, { quantity: s.quantity, avgCost: s.avgCost });
    return m;
  }, [stock]);
  const currentQty = (l: Line) => stockMap.get(`${l.itemId}|${l.warehouseId}`)?.quantity ?? 0;
  const currentCost = (l: Line) => stockMap.get(`${l.itemId}|${l.warehouseId}`)?.avgCost ?? 0;

  const whOptions = useMemo(() => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code })), [warehouses]);
  const whLabel = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "";

  const addLine = (itemId = "", itemLabel = "") =>
    setLines((ls) => [...ls, { id: newId(), itemId, itemLabel, warehouseId: defaultWh, counted: "", unitCost: "" }]);
  const updateLine = (id: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const removeLine = (id: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.id !== id) : ls));

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
        if (empty) return ls.map((l) => (l.id === empty.id ? { ...l, itemId: it.id, itemLabel: label } : l));
        return [...ls, { id: newId(), itemId: it.id, itemLabel: label, warehouseId: defaultWh, counted: "", unitCost: "" }];
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
      if (r.ok) { toast.success("تم حفظ التسوية (مسودة) — راجِعها ثم أكّدها للترحيل"); router.push(r.number ? `/inventory/adjustments/${encodeURIComponent(r.number)}` : "/inventory/adjustments"); router.refresh(); }
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="min-w-56 text-start">اسم الصنف</TableHead>
                  <TableHead className="text-start">المخزن</TableHead>
                  <TableHead className="text-start">الكمية الحالية</TableHead>
                  <TableHead className="text-start">التكلفة الحالية</TableHead>
                  <TableHead className="text-start">الكمية الفعلية</TableHead>
                  <TableHead className="text-start">السعر</TableHead>
                  <TableHead className="text-start">الفرق</TableHead>
                  <TableHead className="w-10" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableLineRows
                  items={lines}
                  onReorder={setLines}
                  renderCells={(l) => {
                    const cur = currentQty(l);
                    const delta = (Number(l.counted) || 0) - cur;
                    const hasCount = l.counted !== "";
                    return (
                      <>
                        <TableCell>
                          <ItemPicker selectedLabel={l.itemLabel} placeholder="ابحث بالاسم أو أي كود…"
                            onSelect={(it) => updateLine(l.id, { itemId: it.id, itemLabel: `${it.code} — ${it.name}` })} />
                        </TableCell>
                        <TableCell>
                          <CellCombobox selectedLabel={whLabel(l.warehouseId)} options={whOptions} placeholder="المستودع…"
                            onSelect={(id) => updateLine(l.id, { warehouseId: id })} />
                        </TableCell>
                        <TableCell><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{q(cur)}</div></TableCell>
                        <TableCell><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{l.itemId ? money(currentCost(l)) : "—"}</div></TableCell>
                        <TableCell><Input type="number" step="1" min="0" className="w-28" value={l.counted} onChange={(e) => updateLine(l.id, { counted: e.target.value.replace(/[^\d]/g, "") })} /></TableCell>
                        <TableCell><Input type="number" step="0.01" min="0" className="w-28" value={l.unitCost} onChange={(e) => updateLine(l.id, { unitCost: e.target.value })} placeholder={delta > 0 && cur === 0 ? "مطلوب" : "تلقائي"} /></TableCell>
                        <TableCell>
                          <div className={`flex h-9 items-center px-2 text-sm font-bold ${!hasCount ? "text-muted-foreground" : delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : ""}`}>
                            {hasCount ? `${delta > 0 ? "+" : ""}${q(delta)}` : "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(l.id)} aria-label="حذف"><Icon name="Trash2" className="size-4 text-destructive" /></Button>
                        </TableCell>
                      </>
                    );
                  }}
                />
              </TableBody>
            </Table>
          </div>

          <div className="flex justify-end">
            <Button disabled={pending} onClick={submit}>حفظ التسوية (مسودة)</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
