"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createDeliveryFromOrderAction, getDeliverableOrderLinesAction, type DeliverableLine } from "@/app/actions/erp/deliveries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Customer = { id: string; nameAr: string };
type Warehouse = { id: string; nameAr: string };
type OpenOrder = { id: string; number: string; customerId: string | null; dateLabel: string };
type Line = DeliverableLine & { warehouseId: string; now: string };

const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export function DeliveryForm({
  orgName, customers, warehouses, openOrders,
}: {
  orgName: string;
  customers: Customer[];
  warehouses: Warehouse[];
  openOrders: OpenOrder[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [customerId, setCustomerId] = useState("");
  const [date, setDate] = useState(today);
  const [orderId, setOrderId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [channel, setChannel] = useState("");
  const mktLabel = channel === "AMAZON" ? "ASIN" : channel === "NOON" ? "كود نون" : "";

  const customerOrders = useMemo(() => openOrders.filter((o) => o.customerId === customerId), [openOrders, customerId]);
  const customerOptions = useMemo(() => customers.map((c) => ({ id: c.id, label: c.nameAr })), [customers]);
  const customerLabelById = useMemo(() => new Map(customerOptions.map((o) => [o.id, o.label])), [customerOptions]);

  const onCustomer = (id: string) => { setCustomerId(id); setOrderId(""); setLines([]); };

  const recall = (id: string) => {
    setOrderId(id);
    setLines([]);
    setChannel("");
    if (!id) return;
    startLoad(async () => {
      const r = await getDeliverableOrderLinesAction(id);
      if (!r.ok || !r.lines) { toast.error(r.error ?? "تعذّر استدعاء الأمر"); return; }
      if (r.lines.length === 0) { toast.message("تم تسليم كل أصناف هذا الأمر"); return; }
      const def = r.defaultWarehouseId ?? warehouses[0]?.id ?? "";
      setChannel(r.channel ?? "");
      setLines(r.lines.map((l) => ({ ...l, warehouseId: l.warehouseId || def, now: String(l.remaining) })));
    });
  };

  const setLine = (itemId: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));

  const totalNow = useMemo(() => lines.reduce((s, l) => s + (Number(l.now) || 0), 0), [lines]);

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (!orderId) return toast.error("استدعِ أمر بيع أولاً");
    if (lines.length === 0) return toast.error("لا توجد أصناف للتسليم");
    if (lines.some((l) => (Number(l.now) || 0) > l.remaining + 1e-6)) return toast.error("الكمية المسلّمة أكبر من المتبقّي");
    if (lines.some((l) => !l.warehouseId && (Number(l.now) || 0) > 0)) return toast.error("اختر مخزن الصرف لكل بند مسلّم");
    const picks = lines.map((l) => ({ itemId: l.itemId, quantity: Number(l.now) || 0, warehouseId: l.warehouseId })).filter((p) => p.quantity > 0);
    if (picks.length === 0) return toast.error("حدّد كمية مسلّمة لبند واحد على الأقل");
    start(async () => {
      const r = await createDeliveryFromOrderAction(orderId, picks, date);
      if (r.ok) {
        toast.success("تم حفظ إذن الصرف (مسودة) — أكّده لترحيله");
        router.push(r.id ? `/sales/deliveries/${r.id}` : "/sales/deliveries");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات إذن الصرف</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || lines.length === 0}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ إذن الصرف</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/sales/deliveries")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>العميل</Label>
            <CellCombobox
              selectedLabel={customerLabelById.get(customerId) ?? ""}
              options={customerOptions}
              onSelect={(id) => onCustomer(id)}
              placeholder="ابحث عن العميل…"
            />
          </div>
          <div className="space-y-2"><Label>تاريخ التسليم</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>استدعاء أمر بيع</Label>
            <select className={selectCls} value={orderId} disabled={!customerId || loading} onChange={(e) => recall(e.target.value)}>
              <option value="">{customerId ? "— اختر أمراً مفتوحاً —" : "اختر العميل أولاً"}</option>
              {customerOrders.map((o) => <option key={o.id} value={o.id}>{o.number} — {o.dateLabel}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />جارٍ تحميل بنود الأمر…</span>
              : customerId && customerOrders.length === 0 ? "لا توجد أوامر بيع مفتوحة لهذا العميل."
              : "تنزل أصناف الأمر المتبقّية (غير المسلّمة) في الجدول."}
          </div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[22rem] text-start">المنتج</TableHead>
                <TableHead className="w-44 text-start">مخزن الصرف</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">المخزون الحالي</TableHead>
                <TableHead className="w-28 text-start">الكمية المسلّمة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">اختر العميل ثم استدعِ أمر بيع لعرض الأصناف.</TableCell></TableRow>
              ) : lines.map((l) => {
                const stock = l.stockByWarehouse[l.warehouseId] ?? 0;
                const short = (Number(l.now) || 0) > stock + 1e-6;
                return (
                  <TableRow key={l.itemId}>
                    <TableCell className="w-[22rem] max-w-[22rem] whitespace-normal">
                      <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{l.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-xs text-muted-foreground">
                        <span>{l.code}</span>
                        {l.marketplaceCode && <span dir="ltr">{mktLabel}: {l.marketplaceCode}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      <select className={selectCls} value={l.warehouseId} onChange={(e) => setLine(l.itemId, { warehouseId: e.target.value })}>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="font-medium">{qtyf(l.remaining)}</TableCell>
                    <TableCell className={`tabular-nums ${short ? "text-destructive" : "text-muted-foreground"}`}>{qtyf(stock)}</TableCell>
                    <TableCell><Input type="number" step="1" min="0" max={l.remaining} value={l.now} onChange={(e) => setLine(l.itemId, { now: e.target.value.replace(/[^\d]/g, "") })} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {lines.length > 0 && (
          <div className="flex justify-end text-sm">
            <div>إجمالي المسلّم: <span className="font-medium">{qtyf(totalNow)}</span></div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
