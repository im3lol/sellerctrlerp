"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createSalesOrderAction, updateSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { getItemWarehouseStockAction, type WarehouseStock } from "@/app/actions/erp/stock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import { ItemThumb } from "@/components/erp/item-thumb";
import { ItemPicker } from "@/components/erp/item-picker";
import { WarehousePicker } from "@/components/erp/warehouse-picker";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { QuickCreateParty, type NewParty } from "@/components/erp/quick-create-party";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { lineVat } from "@/lib/erp/vat";
import { selectCls } from "@/lib/utils";

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null; code?: string | null; image?: string | null };
type Line = { itemId: string; warehouseId: string; stock: WarehouseStock[]; quantity: number; unitPrice: number; discountAmount: number; };

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
const newLine = (): Line => ({ itemId: "", warehouseId: "", stock: [], quantity: 1, unitPrice: 0, discountAmount: 0 });
// VAT is a single document-level choice, same as the purchase order and the quotation:
// one switch for the whole order instead of a «معفى» box on every line. It stays computed
// PER LINE internally because VAT is linear, so the stored line tax — and everything
// derived from it downstream — is unchanged. `applyVat=false` → tax 0.
const lineTax = (l: Line, vatRate: number, applyVat: boolean) =>
  (applyVat && vatRate > 0 ? lineVat(l.quantity, l.unitPrice, l.discountAmount, vatRate, false) : 0);
const lineTotal = (l: Line, vatRate: number, applyVat: boolean) =>
  round2(l.quantity * l.unitPrice - l.discountAmount + lineTax(l, vatRate, applyVat));

const CHANNELS: [string, string][] = [["MANUAL", "يدوي"], ["AMAZON", "أمازون"], ["NOON", "نون"]];

export type SalesOrderInitial = {
  id: string; number: string; customerId: string; date: string; dueDate: string; notes: string;
  channel: string; externalOrderId: string; shippingAmount: number;
  applyVat: boolean;
  lines: { itemId: string; warehouseId: string; quantity: number; unitPrice: number; discountAmount: number }[];
};

export function SalesOrderForm({ customers, items, orgName, vatRate, defaultCustomerId, channelCustomerId, initialLines, initial }: { customers: Customer[]; items: Item[]; orgName: string; vatRate: number; defaultCustomerId?: string; channelCustomerId?: Partial<Record<string, string>>; initialLines?: { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number }[]; initial?: SalesOrderInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;
  const [customerId, setCustomerId] = useState(initial?.customerId ?? defaultCustomerId ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Default: on when the org has a rate at all. Editing restores what the order stored.
  const [applyVat, setApplyVat] = useState(initial ? initial.applyVat : vatRate > 0);
  const [channel, setChannel] = useState(initial?.channel ?? "MANUAL");
  const [externalOrderId, setExternalOrderId] = useState(initial?.externalOrderId ?? "");
  const [shippingAmount, setShippingAmount] = useState(initial?.shippingAmount ?? 0);
  const [lines, setLines] = useState<Line[]>(
    initial?.lines?.length
      ? initial.lines.map((l) => ({ ...newLine(), itemId: l.itemId, warehouseId: l.warehouseId, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount }))
      : initialLines?.length
      ? initialLines.map((l) => ({ ...newLine(), itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount }))
      : [newLine()],
  );

  // Editing: load each seeded line's warehouse stock once so the warehouse picker shows
  // options + on-hand, keeping the stored warehouse selected.
  useEffect(() => {
    if (!isEdit) return;
    lines.forEach((l, i) => {
      if (!l.itemId) return;
      getItemWarehouseStockAction(l.itemId).then((r) => { if (r.ok && r.stock) setLine(i, { stock: r.stock }); });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching to a marketplace channel auto-selects its default customer (e.g. «أمازون مصر») if one exists.
  const onChannel = (c: string) => {
    setChannel(c);
    const cid = channelCustomerId?.[c];
    if (cid) setCustomerId(cid);
  };
  // Customers added from inside the order are not in the server-rendered prop, so they
  // live here until the next load merges them in from the database.
  const [newCustomers, setNewCustomers] = useState<Customer[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const allCustomers = useMemo(() => [...customers, ...newCustomers], [customers, newCustomers]);
  const customerOptions = useMemo(() => allCustomers.map((c) => ({ id: c.id, label: c.nameAr })), [allCustomers]);
  const customerLabelById = useMemo(() => new Map(customerOptions.map((o) => [o.id, o.label])), [customerOptions]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // On item select: set price, then load on-hand per warehouse and default to the most-stocked one.
  const pickItem = (i: number, item: ItemSearchResult) => {
    setLine(i, { itemId: item.id, unitPrice: Number(item.sellPrice) || 0, stock: [], warehouseId: "" });
    getItemWarehouseStockAction(item.id).then((r) => {
      if (!r.ok || !r.stock) return;
      const stocked = r.stock.filter((s) => s.qty > 0).sort((a, b) => b.qty - a.qty);
      const def = (stocked[0] ?? r.stock[0])?.warehouseId ?? "";
      setLine(i, { stock: r.stock, warehouseId: def });
    });
  };

  // Scanning must land the line in the same state a manual pick does — price, warehouse
  // and per-warehouse stock — so it routes through pickItem rather than inserting a bare id.
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
    const tax = round2(lines.reduce((s, l) => s + lineTax(l, vatRate, applyVat), 0));
    const qty = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    return { subtotal, discount, tax, qty, total: round2(subtotal - discount + tax + (Number(shippingAmount) || 0)) };
  }, [lines, vatRate, applyVat, shippingAmount]);

  const submit = () => {
    if (!customerId) return toast.error("اختر العميل");
    if (channel !== "MANUAL" && !externalOrderId.trim()) return toast.error("أدخل رقم الطلب");
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const body = {
        customerId, date, dueDate: dueDate || undefined, notes,
        channel, externalOrderId: externalOrderId.trim() || undefined, shippingAmount: Number(shippingAmount) || 0,
        lines: lines.map((l) => ({ itemId: l.itemId, warehouseId: l.warehouseId || undefined, quantity: l.quantity, unitPrice: l.unitPrice, discountAmount: l.discountAmount, taxAmount: lineTax(l, vatRate, applyVat), exempt: false })),
      };
      const r = isEdit ? await updateSalesOrderAction(initial!.id, body) : await createSalesOrderAction(body);
      if (r.ok) {
        toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ أمر البيع (مسودة) — أكّده");
        if (r.warning) toast.warning(`تنبيه مخزون: ${r.warning}`, { duration: 8000 });
        router.push(r.number ? `/sales/orders/${encodeURIComponent(r.number)}` : "/sales/orders"); router.refresh();
      }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات أمر البيع</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{isEdit ? "حفظ التعديلات" : "حفظ الأمر"}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(isEdit ? `/sales/orders/${initial!.id}` : "/sales/orders")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>العميل</Label>
            <CellCombobox
              selectedLabel={customerLabelById.get(customerId) ?? ""}
              options={customerOptions}
              onSelect={(id) => setCustomerId(id)}
              placeholder="ابحث عن العميل…"
              onCreate={(typed) => { setQuickName(typed); setQuickOpen(true); }}
              createLabel="إضافة عميل"
            />
            <QuickCreateParty
              kind="customer"
              open={quickOpen}
              onOpenChange={setQuickOpen}
              initialName={quickName}
              onCreated={(p: NewParty) => { setNewCustomers((xs) => [...xs, p]); setCustomerId(p.id); }}
            />
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>تاريخ التسليم</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
          <div className="space-y-2">
            <Label>الضريبة</Label>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm">
              <input type="checkbox" checked={applyVat} disabled={vatRate <= 0} onChange={(e) => setApplyVat(e.target.checked)} />
              {vatRate > 0 ? `إضافة ض.ق.م (${qtyf(vatRate)}%)` : "لا توجد نسبة ضريبة مضبوطة"}
            </label>
          </div>
        </div>
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-4 ${isEdit ? "hidden" : ""}`}>
          <div className="space-y-2">
            <Label>القناة</Label>
            <select className={selectCls} value={channel} onChange={(e) => onChannel(e.target.value)}>
              {CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          {channel !== "MANUAL" && (
            <>
              <div className="space-y-2">
                <Label>رقم الطلب ({CHANNELS.find(([k]) => k === channel)?.[1]})</Label>
                <Input value={externalOrderId} onChange={(e) => setExternalOrderId(e.target.value)} placeholder="مثال: 407-..." dir="ltr" />
              </div>
              <div className="space-y-2">
                <Label>الشحن</Label>
                <Input type="number" step="0.01" min="0" value={shippingAmount} onChange={(e) => setShippingAmount(Number(e.target.value))} />
              </div>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-start">صورة</TableHead>
                <TableHead className="w-72 min-w-64 text-start">الصنف</TableHead>
                <TableHead className="w-48 text-start">المستودع</TableHead>
                <TableHead className="w-24 text-start">المخزون الحالي</TableHead>
                <TableHead className="w-24 text-center">الكمية</TableHead>
                <TableHead className="w-32 text-center">السعر</TableHead>
                <TableHead className="w-32 text-center">خصم</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => {
                const opts = l.stock.filter((s) => s.qty > 0);
                const whOpts = opts.length ? opts : l.stock;
                const onHand = l.stock.find((s) => s.warehouseId === l.warehouseId)?.qty ?? 0;
                return (
                  <TableRow key={i}>
                    <TableCell><ItemThumb src={itemById.get(l.itemId)?.image} /></TableCell>
                    <TableCell className="min-w-64 max-w-72">
                      <ItemPicker
                        selected={itemById.get(l.itemId) ? { name: itemById.get(l.itemId)!.nameAr ?? "", code: itemById.get(l.itemId)!.code, image: itemById.get(l.itemId)!.image } : null}
                        onSelect={(it) => pickItem(i, it)}
                      />
                    </TableCell>
                    <TableCell>
                      <WarehousePicker
                        options={whOpts}
                        value={l.warehouseId}
                        disabled={!l.itemId}
                        placeholder={l.itemId ? "ابحث عن مستودع…" : "اختر الصنف أولاً"}
                        onSelect={(id) => setLine(i, { warehouseId: id })}
                      />
                    </TableCell>
                    <TableCell className={`tabular-nums ${onHand <= 0 ? "text-destructive" : "text-muted-foreground"}`}>{l.itemId ? qtyf(onHand) : "—"}</TableCell>
                    <TableCell><Input type="number" step="1" min="1" className="w-20 text-base" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" className="w-28 text-base" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                    <TableCell><Input type="number" step="0.01" className="w-28 text-base" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                    <TableCell className="font-medium">{fmt(lineTotal(l, vatRate, applyVat))}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                );
              })}
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
            <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
            {(Number(shippingAmount) || 0) > 0 && <div>الشحن: <span className="font-medium">{fmt(Number(shippingAmount) || 0)}</span></div>}
            <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
