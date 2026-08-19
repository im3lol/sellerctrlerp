"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createPurchaseOrderAction, updatePurchaseOrderAction } from "@/app/actions/erp/purchase-orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ItemPicker } from "@/components/erp/item-picker";
import { ItemThumb } from "@/components/erp/item-thumb";
import { BarcodeScan } from "@/components/erp/barcode-scan";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { QuickCreateParty, type NewParty } from "@/components/erp/quick-create-party";
import { allocateLandedPerUnit } from "@/lib/erp/landed-cost";
import { lineVat } from "@/lib/erp/vat";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { selectCls } from "@/lib/utils";

type Supplier = { id: string; nameAr: string };
type Warehouse = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; code?: string | null; image?: string | null };
type Currency = { code: string; nameAr: string; isBase: boolean };
type Line = { itemId: string; quantity: number; unitPrice: number; shippingPerUnit: number; discountPerUnit: number };
// Editing an existing DRAFT: line amounts are already in the document currency (the edit
// page converts the stored base amounts back to foreign), so they seed Line directly.
export type PurchaseOrderInitial = {
  id: string; number: string; supplierId: string; warehouseId: string; date: string; notes: string;
  currencyCode: string; exchangeRate: number; applyVat: boolean; lines: Line[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
// VAT is a single document-level choice (not per line). Base = goods value net of discount
// (freight excluded), same convention as the sales side. `applyVat=false` → tax 0.
const lineTax = (l: Line, vatRate: number, applyVat: boolean) => (applyVat && vatRate > 0 ? lineVat(l.quantity, l.unitPrice, l.quantity * l.discountPerUnit, vatRate, false) : 0);
const lineTotal = (l: Line, vatRate: number, applyVat: boolean) => round2(l.quantity * l.unitPrice + l.quantity * l.shippingPerUnit - l.quantity * l.discountPerUnit + lineTax(l, vatRate, applyVat));
const newLine = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, shippingPerUnit: 0, discountPerUnit: 0 });

export function PurchaseOrderForm({ suppliers, warehouses, items, orgName, vatRate, initialLines, lastPrices = {}, currencies = [], latestRates = {}, initial }: { suppliers: Supplier[]; warehouses: Warehouse[]; items: Item[]; orgName: string; vatRate: number; initialLines?: { itemId: string; quantity: number }[]; lastPrices?: Record<string, number>; currencies?: Currency[]; latestRates?: Record<string, number>; initial?: PurchaseOrderInitial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const isEdit = !!initial?.id;
  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [warehouseId, setWarehouseId] = useState(initial?.warehouseId ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  // Document currency. Amounts are entered in this currency; the server converts to the
  // base (EGP) at the exchange rate before posting. `rate` = 1 unit currency → base units.
  const baseCode = currencies.find((c) => c.isBase)?.code ?? "EGP";
  const [currency, setCurrency] = useState(initial?.currencyCode ?? baseCode);
  const isForeign = currency !== baseCode;
  // When editing and the currency is unchanged, keep the document's original rate; otherwise
  // use the latest rate on file for the chosen currency.
  const rate = !isForeign ? 1 : (isEdit && currency === initial?.currencyCode ? Number(initial.exchangeRate) : (latestRates[currency] ?? 0));
  // VAT is a single choice for the whole order (not per line). Default: on when the org has a rate.
  const [applyVat, setApplyVat] = useState(initial ? initial.applyVat : vatRate > 0);
  const [lines, setLines] = useState<Line[]>(
    initial?.lines?.length ? initial.lines
      : initialLines?.length ? initialLines.map((l) => ({ ...newLine(), itemId: l.itemId, quantity: l.quantity, unitPrice: lastPrices[l.itemId] ?? 0 }))
      : [newLine()],
  );
  // Landed costs: total import charges auto-allocated onto each line's shipping/unit.
  const [lc, setLc] = useState({ shipping: "", customs: "", insurance: "", other: "" });
  const [lcMethod, setLcMethod] = useState<"value" | "qty">("value");
  const lcTotal = round2((Number(lc.shipping) || 0) + (Number(lc.customs) || 0) + (Number(lc.insurance) || 0) + (Number(lc.other) || 0));
  const [newSuppliers, setNewSuppliers] = useState<Supplier[]>([]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const allSuppliers = useMemo(() => [...suppliers, ...newSuppliers], [suppliers, newSuppliers]);
  const supplierOptions = useMemo(() => allSuppliers.map((s) => ({ id: s.id, label: s.nameAr })), [allSuppliers]);
  const supplierLabelById = useMemo(() => new Map(supplierOptions.map((o) => [o.id, o.label])), [supplierOptions]);
  // id → row, so a line cell can show the item's picture and code without another query.
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  // Spread the total landed cost onto each line's shipping/unit (by value or by quantity).
  const distributeLanded = () => {
    if (lcTotal <= 0) return toast.error("أدخل قيمة تكاليف الاستيراد أولاً");
    if (!lines.some((l) => l.itemId && l.quantity > 0)) return toast.error("أضف بنوداً بكميات أولاً");
    const perUnit = allocateLandedPerUnit(
      lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, eligible: !!l.itemId })),
      lcTotal,
      lcMethod,
    );
    if (perUnit.every((p) => p === 0)) return toast.error("تعذّر التوزيع — جرّب التوزيع بالكمية");
    setLines((ls) => ls.map((l, i) => ({ ...l, shippingPerUnit: perUnit[i] })));
    toast.success(`تم توزيع ${fmt(lcTotal)} على الشحن لكل وحدة`);
  };

  const addOrBumpItem = (item: ItemSearchResult) =>
    setLines((ls) => {
      const idx = ls.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) return ls.map((l, i) => (i === idx ? { ...l, quantity: l.quantity + 1 } : l));
      const line: Line = { itemId: item.id, quantity: 1, unitPrice: lastPrices[item.id] ?? 0, shippingPerUnit: 0, discountPerUnit: 0 };
      const emptyIdx = ls.findIndex((l) => !l.itemId);
      if (emptyIdx >= 0) return ls.map((l, i) => (i === emptyIdx ? line : l));
      return [...ls, line];
    });

  const totals = useMemo(() => {
    const subtotal = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0));
    const shipping = round2(lines.reduce((s, l) => s + l.quantity * l.shippingPerUnit, 0));
    const discount = round2(lines.reduce((s, l) => s + l.quantity * l.discountPerUnit, 0));
    const tax = round2(lines.reduce((s, l) => s + lineTax(l, vatRate, applyVat), 0));
    const qty = round2(lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    return { subtotal, shipping, discount, tax, qty, total: round2(subtotal + shipping - discount + tax) };
  }, [lines, vatRate, applyVat]);

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!warehouseId) return toast.error("اختر المستودع");
    if (isForeign && rate <= 0) return toast.error(`أضِف سعر صرف لـ${currency} من الإعدادات ← العملات أولاً`);
    if (lines.some((l) => !l.itemId)) return toast.error("اختر الصنف في كل بند");
    start(async () => {
      const payload = lines.map((l) => ({
        itemId: l.itemId, quantity: l.quantity, unitPrice: l.unitPrice, shippingPerUnit: l.shippingPerUnit,
        taxAmount: lineTax(l, vatRate, applyVat), discountAmount: round2(l.quantity * l.discountPerUnit),
      }));
      const body = { supplierId, warehouseId, date, notes, currencyCode: currency, lines: payload };
      const r = isEdit ? await updatePurchaseOrderAction(initial!.id, body) : await createPurchaseOrderAction(body);
      if (r.ok) {
        toast.success(isEdit ? "تم حفظ التعديلات" : "تم حفظ أمر الشراء (مسودة) — أكّده أو ألغِه");
        router.push(r.id ? `/purchases/orders/${r.id}` : "/purchases/orders");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات أمر الشراء</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{isEdit ? "حفظ التعديلات" : "حفظ الأمر"}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(isEdit ? `/purchases/orders/${initial!.id}` : "/purchases/orders")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2">
            <Label>المورد</Label>
            <CellCombobox
              selectedLabel={supplierLabelById.get(supplierId) ?? ""}
              options={supplierOptions}
              onSelect={(id) => setSupplierId(id)}
              placeholder="ابحث عن المورد…"
              onCreate={(typed) => { setQuickName(typed); setQuickOpen(true); }}
              createLabel="إضافة مورد"
            />
            <QuickCreateParty
              kind="supplier"
              open={quickOpen}
              onOpenChange={setQuickOpen}
              initialName={quickName}
              onCreated={(p: NewParty) => { setNewSuppliers((xs) => [...xs, p]); setSupplierId(p.id); }}
            />
          </div>
          <div className="space-y-2">
            <Label>الشركة</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-4">
          <div className="space-y-2"><Label>مسح باركود</Label><BarcodeScan onScan={addOrBumpItem} /></div>
          <div className="space-y-2">
            <Label>المستودع</Label>
            <select className={selectCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>الضريبة</Label>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm">
              <input type="checkbox" checked={applyVat} disabled={vatRate <= 0} onChange={(e) => setApplyVat(e.target.checked)} />
              {vatRate > 0 ? `إضافة ض.ق.م (${qtyf(vatRate)}%)` : "لا توجد نسبة ضريبة مضبوطة"}
            </label>
          </div>
          <div className="space-y-2">
            <Label>العملة</Label>
            {currencies.length <= 1 ? (
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{baseCode}</div>
            ) : (
              <select className={selectCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {currencies.map((c) => <option key={c.code} value={c.code}>{c.nameAr} ({c.code})</option>)}
              </select>
            )}
            {isForeign && (rate > 0
              ? <p className="text-xs text-muted-foreground">١ {currency} = {qtyf(rate)} {baseCode} — تُرحّل الحسابات بالـ{baseCode}</p>
              : <p className="text-xs text-destructive">لا يوجد سعر صرف لـ{currency} — أضِفه من الإعدادات ← العملات</p>)}
          </div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14 text-start">صورة</TableHead>
                <TableHead className="w-72 min-w-64 text-start">الصنف</TableHead>
                <TableHead className="w-28 text-start">الكمية</TableHead>
                <TableHead className="w-36 text-start">السعر</TableHead>
                <TableHead className="w-28 text-start">خصم/وحدة</TableHead>
                <TableHead className="w-28 text-start">شحن/وحدة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <ItemThumb src={itemById.get(l.itemId)?.image} />
                  </TableCell>
                  <TableCell className="min-w-64 max-w-72">
                    <ItemPicker
                      selected={itemById.get(l.itemId) ? { name: itemById.get(l.itemId)!.nameAr ?? "", code: itemById.get(l.itemId)!.code, image: itemById.get(l.itemId)!.image } : null}
                      onSelect={(it) => setLine(i, { itemId: it.id, ...(l.unitPrice === 0 && lastPrices[it.id] ? { unitPrice: lastPrices[it.id] } : {}) })}
                    />
                  </TableCell>
                  <TableCell><Input type="number" step="1" min="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} className="w-20 min-w-20 text-start tabular-nums" /></TableCell>
                  <TableCell><Input type="number" step="0.01" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} className="w-24 min-w-24 text-start tabular-nums" /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" inputMode="decimal" value={l.discountPerUnit} onChange={(e) => setLine(i, { discountPerUnit: Number(e.target.value) })} className="w-24 min-w-24 text-start tabular-nums" /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" inputMode="decimal" value={l.shippingPerUnit} onChange={(e) => setLine(i, { shippingPerUnit: Number(e.target.value) })} className="w-24 min-w-24 text-start tabular-nums" /></TableCell>
                  <TableCell className="font-medium">{fmt(lineTotal(l, vatRate, applyVat))}</TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>

        {/* Landed costs — allocate freight/customs/insurance into per-unit inventory cost */}
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">تكاليف الاستيراد (تُرسمَل في تكلفة المخزون)</Label>
            {lcTotal > 0 && <span className="text-sm text-muted-foreground">الإجمالي: <span className="font-medium">{fmt(lcTotal)}</span></span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5"><Label className="text-xs">الشحن</Label><Input type="number" step="0.01" min="0" value={lc.shipping} onChange={(e) => setLc((s) => ({ ...s, shipping: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">الجمارك</Label><Input type="number" step="0.01" min="0" value={lc.customs} onChange={(e) => setLc((s) => ({ ...s, customs: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">التأمين</Label><Input type="number" step="0.01" min="0" value={lc.insurance} onChange={(e) => setLc((s) => ({ ...s, insurance: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">أخرى</Label><Input type="number" step="0.01" min="0" value={lc.other} onChange={(e) => setLc((s) => ({ ...s, other: e.target.value }))} placeholder="0" /></div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">طريقة التوزيع</Label>
              <select className={`${selectCls} min-w-40`} value={lcMethod} onChange={(e) => setLcMethod(e.target.value as "value" | "qty")}>
                <option value="value">حسب القيمة</option>
                <option value="qty">حسب الكمية</option>
              </select>
            </div>
            <Button type="button" variant="secondary" onClick={distributeLanded}>توزيع على الشحن/وحدة</Button>
            <span className="text-xs text-muted-foreground">يعيد حساب عمود «شحن/وحدة» لكل بند؛ يُرسمَل في المخزون عند الاستلام.</span>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 text-sm">
          <div className="flex flex-col items-start gap-1">
            <div>إجمالي الكمية: <span className="font-medium">{qtyf(totals.qty)}</span></div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div>الإجمالي الفرعي: <span className="font-medium">{fmt(totals.subtotal)}</span></div>
            <div>الشحن: <span className="font-medium">{fmt(totals.shipping)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(totals.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(totals.tax)}</span></div>
            <div className="text-base font-bold text-primary">الإجمالي: {fmt(totals.total)} {isForeign ? currency : baseCode}</div>
            {isForeign && rate > 0 && (
              <div className="text-base font-bold">الإجمالي: {fmt(round2(totals.total * rate))} {baseCode} <span className="text-xs font-normal text-muted-foreground">(يُرحّل بالحسابات)</span></div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
