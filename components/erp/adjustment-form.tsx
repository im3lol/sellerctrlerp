"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Option = { id: string; code: string; name: string };
type Stock = { itemId: string; warehouseId: string; quantity: number };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm";
const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function AdjustmentForm({ items, warehouses, stock }: { items: Option[]; warehouses: Option[]; stock: Stock[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [counted, setCounted] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);

  const currentQty = useMemo(
    () => stock.find((s) => s.itemId === itemId && s.warehouseId === warehouseId)?.quantity ?? 0,
    [stock, itemId, warehouseId],
  );
  const delta = (Number(counted) || 0) - currentQty;

  const submit = () =>
    start(async () => {
      if (!itemId) { toast.error("اختر الصنف"); return; }
      if (!reason.trim()) { toast.error("أدخل سبب التسوية"); return; }
      if (counted === "") { toast.error("أدخل الكمية الفعلية"); return; }
      const r = await createStockAdjustmentAction({
        itemId, warehouseId, mode: "set", value: Number(counted),
        unitCost: unitCost ? Number(unitCost) : undefined, reason, date,
      });
      if (r.ok) { toast.success("تم حفظ التسوية (مسودة) — أكّدها للترحيل"); router.push("/erp/inventory/adjustments"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  return (
    <Card>
      <CardHeader><CardTitle>تسوية مخزون</CardTitle></CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="item">الصنف</Label>
          <select id="item" className={selectCls} value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">— اختر الصنف —</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="wh">المستودع</Label>
          <select id="wh" className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} — {w.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label>الكمية الحالية (النظام)</Label>
          <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{q(currentQty)}</div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="counted">الكمية الفعلية (الجرد)</Label>
          <Input id="counted" type="number" step="0.001" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>الفرق</Label>
          <div className={`flex h-9 items-center rounded-md border px-3 text-sm font-bold ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : ""}`}>
            {delta > 0 ? "+" : ""}{q(delta)} {delta > 0 ? "(فائض)" : delta < 0 ? "(عجز)" : ""}
          </div>
        </div>
        {delta > 0 && currentQty === 0 && (
          <div className="space-y-2">
            <Label htmlFor="cost">تكلفة الوحدة (للفائض الجديد)</Label>
            <Input id="cost" type="number" step="0.01" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="date">التاريخ</Label>
          <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="reason">السبب</Label>
          <select id="reason" className={selectCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="">— اختر السبب —</option>
            <option value="فرق جرد فعلي">فرق جرد فعلي</option>
            <option value="تالف">تالف</option>
            <option value="فاقد">فاقد</option>
            <option value="تصحيح إدخال">تصحيح إدخال</option>
            <option value="رصيد افتتاحي">رصيد افتتاحي</option>
          </select>
        </div>
        <div className="sm:col-span-2 flex justify-end">
          <Button disabled={pending || delta === 0} onClick={submit}>حفظ التسوية (مسودة)</Button>
        </div>
      </CardContent>
    </Card>
  );
}
