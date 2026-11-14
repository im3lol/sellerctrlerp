"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { createReceiptFromOrderAction, updateReceiptDraftAction, getReceivableOrderLinesAction, type ReceivableLine, type ReceiptDraftInitial } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { ItemThumb } from "@/components/erp/item-thumb";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { selectCls } from "@/lib/utils";

type Supplier = { id: string; nameAr: string };
type Warehouse = { id: string; nameAr: string };
type OpenOrder = { id: string; number: string; supplierId: string | null; dateLabel: string };
type Line = Omit<ReceivableLine, "received"> & { warehouseId: string; received: string; rejected: string; batchNo: string; expiryDate: string; shippingPerUnit: number; selected: boolean; receivedBefore: number };

const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 4 });
const addDays = (iso: string, days: number) => { const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };

export function GoodsReceiptForm({
  orgName, suppliers, warehouses, openOrders, preset, initial, backHref = "/purchases/receipts",
}: {
  orgName: string;
  suppliers: Supplier[];
  warehouses: Warehouse[];
  openOrders: OpenOrder[];
  preset?: { orderId: string; supplierId: string; lines: ReceivableLine[]; defaultWarehouseId: string };
  initial?: ReceiptDraftInitial;
  backHref?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? preset?.supplierId ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [orderId, setOrderId] = useState(initial?.orderId ?? preset?.orderId ?? "");
  const requestVersion = useRef(0);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [lineFilter, setLineFilter] = useState("");
  const [lines, setLines] = useState<Line[]>(() => (preset?.lines ?? []).map(l => {
    const saved = initial?.lines.find(p => p.itemId === l.itemId);
    return { ...l, receivedBefore: l.received, selected: !!saved,
      warehouseId: saved?.warehouseId ?? (warehouses.some(w => w.id === preset?.defaultWarehouseId) ? preset!.defaultWarehouseId : warehouses[0]?.id ?? ""),
      received: String(saved?.quantity ?? l.remaining), rejected: String(saved?.rejectedQty ?? 0),
      batchNo: saved?.batchNo ?? "", expiryDate: saved?.expiryDate ?? (l.isPerishable && l.shelfLifeDays ? addDays(initial?.date ?? today, l.shelfLifeDays) : ""),
      shippingPerUnit: saved?.shippingPerUnit ?? l.poShippingPerUnit,
    };
  }));

  const supplierOrders = useMemo(() => openOrders.filter((o) => o.supplierId === supplierId), [openOrders, supplierId]);
  const supplierOptions = useMemo(() => suppliers.map((s) => ({ id: s.id, label: t(s.nameAr) })), [suppliers, t]);
  const supplierLabelById = useMemo(() => new Map(supplierOptions.map((o) => [o.id, o.label])), [supplierOptions]);

  const onSupplier = (id: string) => { ++requestVersion.current; setSupplierId(id); setOrderId(""); setLines([]); setLineFilter(""); };

  const recall = (id: string) => {
    const version = ++requestVersion.current;
    setOrderId(id);
    setLines([]);
    if (!id) return;
    startLoad(async () => {
      const r = await getReceivableOrderLinesAction(id);
      if (version !== requestVersion.current) return;
      if (!r.ok || !r.lines) { toast.error(r.error ?? t("تعذّر استدعاء الأمر")); return; }
      if (r.lines.length === 0) { toast.message("تم استلام كل أصناف هذا الأمر"); return; }
      const def = warehouses.some(w => w.id === r.defaultWarehouseId) ? r.defaultWarehouseId! : warehouses[0]?.id ?? "";
      setLines(r.lines.map((l) => ({
        ...l, receivedBefore: l.received, selected: false, warehouseId: def, received: String(l.remaining), rejected: "0",
        batchNo: "", expiryDate: l.isPerishable && l.shelfLifeDays ? addDays(date, l.shelfLifeDays) : "",
        shippingPerUnit: l.poShippingPerUnit,
      })));
    });
  };

  const setLine = (itemId: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));

  const totalReceived = useMemo(() => lines.reduce((s, l) => s + (l.selected ? Number(l.received) || 0 : 0), 0), [lines]);
  const totalRejected = useMemo(() => lines.reduce((s, l) => s + (l.selected ? Number(l.rejected) || 0 : 0), 0), [lines]);


  const selectedLines = lines.filter(l => l.selected);
  const visibleLines = lines.filter(l => `${l.code} ${l.name}`.toLowerCase().includes(lineFilter.trim().toLowerCase()));

  const hasLotFields = lines.some(l => l.isPerishable || l.batchNo || l.expiryDate);
  const submit = () => {
    if (!date) return toast.error("تاريخ استلام غير صالح");
    if (!supplierId) return toast.error("اختر المورد");
    if (!orderId) return toast.error("استدعِ أمر شراء أولاً");
    if (lines.length === 0) return toast.error("لا توجد أصناف للاستلام");
    if (selectedLines.some((l) => (Number(l.received) || 0) > l.remaining + 1e-6)) return toast.error("الكمية المستلمة أكبر من المتبقّي");
    if (selectedLines.some((l) => !l.warehouseId && (Number(l.received) || 0) > 0)) return toast.error("اختر مخزن الاستلام لكل بند مستلم");
    if (selectedLines.some((l) => l.isPerishable && (Number(l.received) || 0) > 0 && !l.expiryDate)) return toast.error("أدخل تاريخ الصلاحية للأصناف القابلة للانتهاء");
    if (selectedLines.some(l => !Number.isFinite(Number(l.received)) || Number(l.received) < 0 || !Number.isFinite(Number(l.rejected)) || Number(l.rejected) < 0)) return toast.error("كمية غير صالحة");
    const picks = selectedLines
      .map((l) => ({ itemId: l.itemId, quantity: Number(l.received) || 0, rejectedQty: Number(l.rejected) || 0, warehouseId: l.warehouseId, batchNo: l.batchNo || null, expiryDate: l.expiryDate || null, shippingPerUnit: l.shippingPerUnit }))
      .filter((p) => p.quantity > 0 || p.rejectedQty > 0);
    if (picks.length === 0) return toast.error("حدّد كمية مستلمة أو مرفوضة لبند واحد على الأقل");
    start(async () => {
      const r = initial
        ? await updateReceiptDraftAction(initial.id, { picks, date, notes, expectedUpdatedAt: initial.updatedAt })
        : await createReceiptFromOrderAction(orderId, picks, date, notes);
      if (r.ok) {
        toast.success(initial ? "تم حفظ تعديلات مسودة الاستلام" : "تم حفظ إذن الاستلام (مسودة) — أكّده لترحيله");
        router.push(r.number ? `/purchases/receipts/${encodeURIComponent(r.number)}` : "/purchases/receipts");
        router.refresh();
      } else toast.error(r.error ?? t("تعذّر الحفظ"));
    });
  };

  return (
    <Card>
      <CardHeader data-page-actions="" className="sticky top-16 z-20 rounded-t-xl border-b bg-card/95 py-3 backdrop-blur print:static [&>div]:flex-wrap [&_button]:max-w-full [&_button]:whitespace-normal">
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>{t("بيانات إذن الاستلام")}</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || loading || selectedLines.length === 0}>{pending && <Loader2 className="size-4 animate-spin" />}{t(initial ? "حفظ التعديلات" : "حفظ الاستلام")}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push(backHref)}>{t("إلغاء")}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <fieldset disabled={pending || loading} className="min-w-0 space-y-5" aria-label={t("بيانات إذن الاستلام")}>
        {/* Section 1 — البيانات */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("الشركة")}</Label>
            <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div>
          </div>
          <div className="space-y-2">
            <Label>{t("المورد")}</Label>
            {initial ? <Input value={supplierLabelById.get(supplierId) ?? ""} disabled /> : <CellCombobox
              selectedLabel={supplierLabelById.get(supplierId) ?? ""}
              options={supplierOptions}
              onSelect={(id) => onSupplier(id)}
              placeholder={t("ابحث عن المورد…")}
            />}
          </div>
          <div className="space-y-2"><Label htmlFor="receipt-date">{t("تاريخ الاستلام")}</Label><Input id="receipt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        {/* Recall an open purchase order for the chosen supplier */}
        <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="receipt-order">{t("استدعاء أمر شراء")}</Label>
            <select id="receipt-order" className={selectCls} value={orderId} disabled={!!initial || !supplierId || loading} onChange={(e) => recall(e.target.value)}>
              <option value="">{supplierId ? t("— اختر أمراً مفتوحاً —") : t("اختر المورد أولاً")}</option>
              {supplierOrders.map((o) => <option key={o.id} value={o.id}>{o.number} — {o.dateLabel}</option>)}
            </select>
          </div>
          <div className="flex items-end text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("جارٍ تحميل بنود الأمر…")}</span>
              : supplierId && supplierOrders.length === 0 ? t("لا توجد أوامر شراء مفتوحة لهذا المورد.")
              : t("تنزل أصناف الأمر المتبقّية (غير المستلمة) في الجدول.")}
          </div>
        </div>

        <div className="space-y-2"><Label htmlFor="receipt-notes">{t("ملاحظات")}</Label><Input id="receipt-notes" value={notes} onChange={e => setNotes(e.target.value)} maxLength={2000} /></div>
        {lines.length > 0 && <div className="flex flex-wrap items-center gap-2">
          <Input className="max-w-sm" aria-label={t("بحث أصناف الاستلام")} placeholder={t("ابحث بكود الصنف أو اسمه…")} value={lineFilter} onChange={e => setLineFilter(e.target.value)} />
          <Button type="button" variant="outline" size="sm" onClick={() => { const ids = new Set(visibleLines.filter(l => l.remaining > 0).map(l => l.itemId)); setLines(current => current.map(l => ids.has(l.itemId) ? { ...l, selected: true } : l)); }}>{t("اختيار الأصناف الظاهرة")}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setLines(current => current.map(l => ({ ...l, selected: false })))}>{t("امسح الاختيار")}</Button>
          <span className="text-sm text-muted-foreground">{t("محدَّد")} {selectedLines.length} / {lines.length}</span>
          <p className="w-full text-xs text-muted-foreground">{t("حدّد الأصناف التي وصلت فقط وعدّل الكميات المستلمة. الباقي يظل مفتوحًا على أمر الشراء. الحفظ مسودة لا يؤثر على المخزون أو الحسابات حتى التأكيد.")}</p>
        </div>}
        {/* Table — بيانات الجدول */}
        <div className="rounded-xl border" data-receipt-entry="">
          <Table className={hasLotFields ? "min-w-[68rem]" : "min-w-[56rem]"}>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">{t("اختيار")}</TableHead>
                <TableHead className="w-14 text-start">{t("صورة")}</TableHead>
                <TableHead className="w-40 text-start sm:w-56">{t("المنتج")}</TableHead>
                <TableHead className="w-44 text-start">{t("مخزن الاستلام")}</TableHead>
                <TableHead className="w-24 text-start">{t("المتبقّي")}</TableHead>
                <TableHead className="w-28 text-start">{t("المخزون الحالي")}</TableHead>
                <TableHead className="w-28 text-start">{t("الكمية المستلمة")}</TableHead>
                <TableHead className="w-28 text-start">{t("الكمية المرفوضة")}</TableHead>
                {hasLotFields && <TableHead className="w-32 text-start">{t("رقم التشغيلة")}</TableHead>}
                {hasLotFields && <TableHead className="w-36 text-start">{t("تاريخ الصلاحية")}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleLines.length === 0 ? (
                <TableRow><TableCell colSpan={hasLotFields ? 10 : 8} className="py-10 text-center text-muted-foreground">{t(lines.length ? "لا توجد أصناف مطابقة للبحث" : "اختر المورد ثم استدعِ أمر شراء لعرض الأصناف.")}</TableCell></TableRow>
              ) : (
                <PaginatedTableRows key={`${lineFilter}|${orderId}`} rows={visibleLines.map((l) => (
                  <TableRow key={l.itemId} className={l.selected ? undefined : "bg-muted/20"}>
                    <TableCell><input type="checkbox" disabled={pending || loading} className="size-4" aria-label={`${t("استلام الصنف")} ${l.code}`} checked={l.selected} onChange={e => setLine(l.itemId, { selected: e.target.checked })} /></TableCell>
                    <TableCell className="w-14"><ItemThumb src={l.image} className="size-14 bg-white" /></TableCell>
                    <TableCell className="w-40 min-w-40 max-w-40 whitespace-normal sm:w-56 sm:min-w-56 sm:max-w-80"><div dir="auto" className="max-w-32 text-start font-medium leading-relaxed [overflow-wrap:anywhere] sm:max-w-none" title={l.name}>{t(l.name)}</div><div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.code}</div></TableCell>
                    <TableCell>
                      <select className={`${selectCls} min-w-36`} disabled={!l.selected || pending || loading} aria-label={`${t("مخزن الاستلام")} ${l.code}`} value={l.warehouseId} onChange={(e) => setLine(l.itemId, { warehouseId: e.target.value })}>
                        {warehouses.map((w) => <option key={w.id} value={w.id}>{t(w.nameAr)}</option>)}
                      </select>
                    </TableCell>
                    <TableCell className="font-medium">{qtyf(l.remaining)}<span className="mt-1 block text-xs font-normal text-muted-foreground">{t("المطلوب")}: {qtyf(l.ordered)}<br />{t("مُستلم سابقاً")}: {qtyf(l.receivedBefore)}</span></TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">{qtyf(l.stockByWarehouse[l.warehouseId] ?? 0)}</TableCell>
                    <TableCell><Input className="w-20" aria-label={`${t("الكمية المستلمة")} ${l.code}`} disabled={!l.selected || pending || loading} type="number" step="0.0001" min="0" max={l.remaining} value={l.received} onChange={(e) => setLine(l.itemId, { received: e.target.value })} /></TableCell>
                    <TableCell><Input className="w-20" aria-label={`${t("الكمية المرفوضة")} ${l.code}`} disabled={!l.selected || pending || loading} type="number" step="0.0001" min="0" value={l.rejected} onChange={(e) => setLine(l.itemId, { rejected: e.target.value })} /></TableCell>
                    {hasLotFields && <TableCell>{l.isPerishable || l.batchNo ? <Input aria-label={`${t("رقم التشغيلة")} ${l.code}`} className="w-28" disabled={!l.selected || pending || loading} value={l.batchNo} onChange={(e) => setLine(l.itemId, { batchNo: e.target.value })} placeholder={t("اختياري")} /> : <span className="text-muted-foreground">—</span>}</TableCell>}
                    {hasLotFields && <TableCell>{l.isPerishable || l.expiryDate ? <Input aria-label={`${t("تاريخ الصلاحية")} ${l.code}`} className="w-32" disabled={!l.selected || pending || loading} type="date" value={l.expiryDate} onChange={(e) => setLine(l.itemId, { expiryDate: e.target.value })} /> : <span className="text-muted-foreground">—</span>}</TableCell>}
                  </TableRow>
                ))} />
              )}
            </TableBody>
          </Table>
        </div>

        {lines.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground lg:hidden">{t("اسحب الجدول أفقيًا لعرض الكميات ومخزن الاستلام.")}</p>
            <p className="text-xs text-muted-foreground">
              {t("تكاليف الشحن والجمارك تُسجَّل بعد الاستلام من «المشتريات ← تكاليف الاستيراد»، وتُوزَّع هناك على هذا الإذن.")}
            </p>
            <div className="flex justify-end gap-6 text-sm">
              <div>{t("إجمالي المستلم:")} <span className="font-medium">{qtyf(totalReceived)}</span></div>
              <div>{t("إجمالي المرفوض:")} <span className="font-medium">{qtyf(totalRejected)}</span></div>
            </div>
          </>
        )}
        </fieldset>
      </CardContent>
    </Card>
  );
}
