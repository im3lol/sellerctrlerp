"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockTransferAction } from "@/app/actions/erp/stock-transfers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";

type Option = { id: string; code: string; name: string };
type Line = { itemId: string; quantity: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const empty = (): Line => ({ itemId: "", quantity: "" });

export function TransferForm({ items, warehouses }: { items: Option[]; warehouses: Option[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [fromWh, setFromWh] = useState(warehouses[0]?.id ?? "");
  const [toWh, setToWh] = useState(warehouses[1]?.id ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([empty()]);

  const update = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((p) => [...p, empty()]);
  const removeLine = (i: number) => setLines((p) => (p.length <= 1 ? p : p.filter((_, idx) => idx !== i)));

  const submit = () =>
    start(async () => {
      if (fromWh === toWh) { toast.error("اختر مستودعين مختلفين"); return; }
      const picked = lines.filter((l) => l.itemId && Number(l.quantity) > 0)
        .map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity) }));
      if (picked.length === 0) { toast.error("أضف صنفاً واحداً على الأقل"); return; }
      const r = await createStockTransferAction({ fromWarehouseId: fromWh, toWarehouseId: toWh, date, notes, lines: picked });
      if (r.ok) { toast.success("تم حفظ التحويل (مسودة) — أكّده للترحيل"); router.push("/erp/inventory/transfers"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>تحويل مخزني</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="from">من مستودع</Label>
            <select id="from" className={selectCls} value={fromWh} onChange={(e) => setFromWh(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="to">إلى مستودع</Label>
            <select id="to" className={selectCls} value={toWh} onChange={(e) => setToWh(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="date">التاريخ</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">ملاحظات</Label>
            <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>الأصناف</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">الصنف</TableHead>
                <TableHead className="text-start w-40">الكمية</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <select className={`${selectCls} min-w-48`} value={l.itemId} onChange={(e) => update(i, { itemId: e.target.value })}>
                      <option value="">— اختر الصنف —</option>
                      {items.map((it) => <option key={it.id} value={it.id}>{it.code} — {it.name}</option>)}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input type="number" step="0.001" min="0" value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                      <Icon name="Trash2" className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between">
            <Button type="button" variant="outline" onClick={addLine}><Icon name="Plus" className="size-4" />إضافة صنف</Button>
            <Button type="button" disabled={pending} onClick={submit}>حفظ التحويل (مسودة)</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
