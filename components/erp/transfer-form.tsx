"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockTransferAction, updateStockTransferAction } from "@/app/actions/erp/stock-transfers";
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
type Stock = { itemId: string; warehouseId: string; quantity: number };
type Line = { id: string; itemId: string; itemLabel: string; fromWh: string; toWh: string; quantity: string };
const newId = () => crypto.randomUUID();

const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export type TransferInitial = { id: string; date: string; notes: string; lines: { itemId: string; itemLabel: string; fromWh: string; toWh: string; quantity: string }[] };

export function TransferForm({
  orgName,
  warehouses,
  stock,
  initial,
}: {
  orgName: string;
  warehouses: Option[];
  stock: Stock[];
  initial?: TransferInitial;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;

  const [date, setDate] = useState(initial?.date ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const defFrom = warehouses[0]?.id ?? "";
  const defTo = warehouses[1]?.id ?? warehouses[0]?.id ?? "";
  const [lines, setLines] = useState<Line[]>(
    initial?.lines?.length
      ? initial.lines.map((l) => ({ id: newId(), ...l }))
      : [{ id: newId(), itemId: "", itemLabel: "", fromWh: defFrom, toWh: defTo, quantity: "" }],
  );

  const stockMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) m.set(`${s.itemId}|${s.warehouseId}`, s.quantity);
    return m;
  }, [stock]);
  const available = (l: Line) => stockMap.get(`${l.itemId}|${l.fromWh}`) ?? 0;

  const whOptions = useMemo(() => warehouses.map((w) => ({ id: w.id, label: w.name, hint: w.code })), [warehouses]);
  const whLabel = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "";

  const addLine = (itemId = "", itemLabel = "") =>
    setLines((ls) => [...ls, { id: newId(), itemId, itemLabel, fromWh: defFrom, toWh: defTo, quantity: "" }]);
  const updateLine = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
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
      setLines((ls) => {
        const empty = ls.find((l) => !l.itemId);
        if (empty) return ls.map((l) => (l.id === empty.id ? { ...l, itemId: it.id, itemLabel: label } : l));
        return [...ls, { id: newId(), itemId: it.id, itemLabel: label, fromWh: defFrom, toWh: defTo, quantity: "" }];
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
      const body = {
        date, notes,
        lines: ready.map((l) => ({ itemId: l.itemId, fromWarehouseId: l.fromWh, toWarehouseId: l.toWh, quantity: Number(l.quantity) })),
      };
      const r = isEdit ? await updateStockTransferAction(initial!.id, body) : await createStockTransferAction(body);
      if (r.ok) { toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ التحويل (مسودة) — أكّده للترحيل"); router.push(r.number ? `/inventory/transfers/${encodeURIComponent(r.number)}` : "/inventory/transfers"); router.refresh(); }
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
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead className="min-w-56 text-start">اسم الصنف</TableHead>
                  <TableHead className="text-start">من مستودع</TableHead>
                  <TableHead className="text-start">إلى مستودع</TableHead>
                  <TableHead className="text-start">المتاح</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="w-10" />
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <SortableLineRows
                  items={lines}
                  onReorder={setLines}
                  renderCells={(l) => {
                    const avail = available(l);
                    const over = l.itemId && Number(l.quantity) > avail + 1e-9;
                    return (
                      <>
                        <TableCell>
                          <ItemPicker selectedLabel={l.itemLabel} placeholder="ابحث بالاسم أو أي كود…"
                            onSelect={(it) => updateLine(l.id, { itemId: it.id, itemLabel: `${it.code} — ${it.name}` })} />
                        </TableCell>
                        <TableCell>
                          <CellCombobox selectedLabel={whLabel(l.fromWh)} options={whOptions} placeholder="من…"
                            onSelect={(id) => updateLine(l.id, { fromWh: id })} />
                        </TableCell>
                        <TableCell>
                          <CellCombobox selectedLabel={whLabel(l.toWh)} options={whOptions} placeholder="إلى…"
                            onSelect={(id) => updateLine(l.id, { toWh: id })} />
                        </TableCell>
                        <TableCell><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{l.itemId ? q(avail) : "—"}</div></TableCell>
                        <TableCell><Input type="number" step="1" min="1" className={`w-28 ${over ? "border-destructive text-destructive" : ""}`} value={l.quantity} onChange={(e) => updateLine(l.id, { quantity: e.target.value.replace(/[^\d]/g, "") })} /></TableCell>
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
            <Button disabled={pending} onClick={submit}>{isEdit ? "حفظ التعديلات" : "حفظ التحويل (مسودة)"}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
