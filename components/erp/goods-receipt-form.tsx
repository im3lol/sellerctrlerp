"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createReceiptFromOrderAction, getReceivableOrderLinesAction, type ReceivableLine } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Supplier = { id: string; nameAr: string };
type Warehouse = { id: string; nameAr: string };
type OpenOrder = { id: string; number: string; supplierId: string | null; dateLabel: string };
type Line = Omit<ReceivableLine, "received"> & { warehouseId: string; received: string; rejected: string; batchNo: string; expiryDate: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const addDays = (iso: string, days: number) => { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export function GoodsReceiptForm({
  orgName, suppliers, warehouses, openOrders,
}: {
  orgName: string;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  openOrders: OpenOrder[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today);
  const [orderId, setOrderId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  const supplierOrders = useMemo(() => openOrders.filter((o) => o.supplierId === supplierId), [openOrders, supplierId]);

  const onSupplier = (id: string) => { setSupplierId(id); setOrderId(""); setLines([]); };

  const recall = (id: string) => {
    setOrderId(id);
    setLines([]);
    if (!id) return;
    startLoad(async () => {
      const r = await getReceivableOrderLinesAction(id);
      if (!r.ok || !r.lines) { toast.error(r.error ?? "تعذّر استدعاء الأمر"); return; }
      if (r.lines.length === 0) { toast.message("تم استلام كل أصناف هذا الأمر"); return; }
      const def = r.defaultWarehouseId ?? warehouses[0]?.id ?? "";
      setLines(r.lines.map((l) => ({
        ...l, warehouseId: def, received: String(l.remaining), rejected: "0",
        batchNo: "", expiryDate: l.isPerishable && l.shelfLifeDays ? addDays(date, l.shelfLifeDays) : "",
      })));
    });
  };

  const setLine = (itemId: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));

  const totalReceived = useMemo(() => lines.reduce((s, l) => s + (Number(l.received) || 0), 0), [lines]);
  const totalRejected = useMemo(() => lines.reduce((s, l) => s + (Number(l.rejected) || 0), 0), [lines]);

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!orderId) return toast.error("استدعِ أمر شراء أولاً");
    if (lines.length === 0) return toast.error("لا توجد أصناف للاستلام");
    if (lines.some((l) => (Number(l.received) || 0) > l.remaining + 1e-6)) return toast.error("الكمية المستلمة أكبر من المتبقّي");
    if (lines.some((l) => !l.warehouseId && (Number(l.received) || 0) > 0)) return toast.error("اختر مخزن الاستلام لكل بند مستلم");
    if (lines.some((l) => l.isPerishable && (Number(l.received) || 0) > 0 && !l.expiryDate)) return toast.error("أدخل تاريخ الصلاحية للأصناف القابلة للانتهاء");
    const picks = lines
      .map((l) => ({ itemId: l.itemId, quantity: Number(l.received) || 0, rejectedQty: Number(l.rejected) || 0, warehouseId: l.warehouseId, batchNo: l.batchNo || null, expiryDate: l.expiryDate || null }))
      .filter((p) => p.quantity > 0 || p.rejectedQty > 0);
    if (picks.length === 0) return toast.error("حدّد كمية مستلمة أو مرفوضة لبند واحد على الأقل");
    start(async () => {
      const r = await createReceiptFromOrderAction(orderId, picks, date);
      if (r.ok) {
        toast.success("تم حفظ إذن الاستلام (مسودة) — أكّده لترحيله");
        router.push(r.id ? `/erp/purchases/receipts/${r.id}` : "/erp/purchases/receipts");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات إذن الاستلام</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || lines.length === 0}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الاستلام</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/erp/purchases/receipts")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Section 1 — البيانات */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>المورد</Label>
            <select className={selectCls} value={supplierId} onChange={(e) => onSupplier(e.target.value)}>
              <option value="">— اختر —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2"><Label>تاريخ الاستلام</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        {/* Recall an open purchase order for the chosen supplier */}
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>استدعاء أمر شراء</Label>
            <select className={selectCls} value={orderId} disabled={!supplierId || loading} onChange={(e) => recall(e.target.value)}>
              <option value="">{supplierId ? "— اختر أمراً مفتوحاً —" : "اختر المورد أولاً"}</option>
              {supplierOrders.map((o) => <option key={o.id} value={o.id}>{o.number} — {o.dateLabel}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />جارٍ تحميل بنود الأمر…</span>
              : supplierId && supplierOrders.length === 0 ? "لا توجد أوامر شراء مفتوحة لهذا المورد."
              : "تنزل أصناف الأمر المتبقّية (غير المستلمة) في الجدول."}
          </div>
        </div>

        {/* Table — بيانات الجدول */}
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">المنتج</TableHead>
                <TableHead className="w-44 text-start">مخزن الاستلام</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">المخزون الحالي</TableHead>
                <TableHead className="w-28 text-start">الكمية المستلمة</TableHead>
                <TableHead className="w-28 text-start">الكمية المرفوضة</TableHead>
                <TableHead className="w-32 text-start">رقم التشغيلة</TableHead>
                <TableHead className="w-36 text-start">تاريخ الصلاحية</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">اختر المورد ثم استدعِ أمر شراء لعرض الأصناف.</TableCell></TableRow>
              ) : lines.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell><span className="font-mono text-muted-foreground">{l.code}</span> {l.name}</TableCell>
                  <TableCell>
                    <select className={selectCls} value={l.warehouseId} onChange={(e) => setLine(l.itemId, { warehouseId: e.target.value })}>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                    </select>
                  </TableCell>
                  <TableCell className="font-medium">{qtyf(l.remaining)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{qtyf(l.stockByWarehouse[l.warehouseId] ?? 0)}</TableCell>
                  <TableCell><Input type="number" step="0.001" min="0" max={l.remaining} value={l.received} onChange={(e) => setLine(l.itemId, { received: e.target.value })} /></TableCell>
                  <TableCell><Input type="number" step="0.001" min="0" value={l.rejected} onChange={(e) => setLine(l.itemId, { rejected: e.target.value })} /></TableCell>
                  <TableCell>{l.isPerishable ? <Input value={l.batchNo} onChange={(e) => setLine(l.itemId, { batchNo: e.target.value })} placeholder="اختياري" /> : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{l.isPerishable ? <Input type="date" value={l.expiryDate} onChange={(e) => setLine(l.itemId, { expiryDate: e.target.value })} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {lines.length > 0 && (
          <div className="flex justify-end gap-6 text-sm">
            <div>إجمالي المستلم: <span className="font-medium">{qtyf(totalReceived)}</span></div>
            <div>إجمالي المرفوض: <span className="font-medium">{qtyf(totalRejected)}</span></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
