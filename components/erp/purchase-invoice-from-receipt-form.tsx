"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { convertReceiptToInvoiceAction, getReceiptInvoicePreviewAction, type ReceiptInvoicePreview } from "@/app/actions/erp/goods-receipts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Supplier = { id: string; nameAr: string };
type BillableReceipt = {
  id: string; number: string; supplierId: string | null; dateLabel: string;
  /** The rate approved on the purchase order and stamped on this receipt. */
  currencyCode: string; exchangeRate: number; orderNumber: string | null;
};
type CurrencyOption = { code: string; nameAr: string; isBase: boolean; exchangeRate: string };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });
/** Rates are stored to 6dp; showing 3 would display a small-unit currency as zero. */
const ratef = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 6 });

export function PurchaseInvoiceFromReceiptForm({
  orgName, suppliers, receipts, currencies = [], latestRates = {},
}: {
  orgName: string;
  suppliers: Supplier[];
  receipts: BillableReceipt[];
  currencies?: CurrencyOption[];
  latestRates?: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  // One invoice per receipt stays the rule — that is what makes GRNI clear exactly. This
  // is only a shortcut for raising several of them: tick the receipts, get a draft each.
  const [picked, setPicked] = useState<string[]>([]);
  const receiptId = picked.length === 1 ? picked[0] : "";
  const [preview, setPreview] = useState<ReceiptInvoicePreview | null>(null);

  const baseCurrency = currencies.find((c) => c.isBase);
  const baseCode = baseCurrency?.code ?? "EGP";
  const foreignCurrencies = currencies.filter((c) => !c.isBase);

  // The rate is NOT chosen here. One rate is approved on the purchase order and carried by
  // the receipt; the invoice shows it and inherits it. The inputs below only appear for a
  // receipt that carries no rate of its own — a receipt raised outside an order — because
  // then there is nothing to inherit.
  const [currencyCode, setCurrencyCode] = useState(baseCode);
  const [exchangeRate, setExchangeRate] = useState<string>("1");

  const onCurrencyChange = (code: string) => {
    setCurrencyCode(code);
    const cur = currencies.find((c) => c.code === code);
    setExchangeRate(cur?.isBase ? "1" : (latestRates[code] ? String(latestRates[code]) : (cur?.exchangeRate ?? "")));
  };

  const supplierReceipts = useMemo(() => receipts.filter((r) => r.supplierId === supplierId), [receipts, supplierId]);
  const supplierOptions = useMemo(() => suppliers.map((s) => ({ id: s.id, label: s.nameAr })), [suppliers]);
  const supplierLabelById = useMemo(() => new Map(supplierOptions.map((o) => [o.id, o.label])), [supplierOptions]);

  const onSupplier = (id: string) => { setSupplierId(id); setPicked([]); setPreview(null); };

  /** Preview only makes sense for a single receipt — several produce several invoices. */
  const selectReceipts = (ids: string[]) => {
    setPicked(ids);
    setPreview(null);
    if (ids.length !== 1) return;
    startLoad(async () => {
      const r = await getReceiptInvoicePreviewAction(ids[0]);
      if (!r.ok || !r.preview) { toast.error(r.error ?? "تعذّر استدعاء الإذن"); return; }
      if (r.preview.lines.length === 0) { toast.message("لا توجد كميات قابلة للفوترة في هذا الإذن"); return; }
      setPreview(r.preview);
    });
  };

  const toggleReceipt = (id: string) =>
    selectReceipts(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  // What the chosen receipt was valued at. This is the approved rate: the buyer picked it
  // on the purchase order, the receipt carries it, and this invoice inherits it. It is
  // shown, not asked for.
  const chosen = useMemo(() => receipts.find((r) => r.id === receiptId) ?? null, [receipts, receiptId]);
  const inherited = chosen && chosen.exchangeRate > 0 && chosen.currencyCode !== baseCode
    ? { code: chosen.currencyCode, rate: chosen.exchangeRate, from: chosen.orderNumber }
    : null;
  /** Only a receipt with no rate of its own leaves anything to choose here. */
  const needsOwnRate = !!chosen && !inherited && chosen.currencyCode === baseCode && foreignCurrencies.length > 0;

  const isForeign = inherited ? true : currencyCode !== baseCode;
  const rate = inherited ? inherited.rate : (parseFloat(exchangeRate) || 1);
  const shownCurrency = inherited ? inherited.code : currencyCode;
  // For a foreign currency, the foreign display total = base ÷ rate.
  const foreignTotal = preview && isForeign ? preview.total / rate : null;

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورد");
    if (!picked.length) return toast.error("اختر إذن استلام واحد على الأقل");

    // Several receipts → several drafts, raised one after another. Each carries its own
    // receipt's approved rate, so they are independent documents, not one split bill.
    if (picked.length > 1) {
      return start(async () => {
        const done: string[] = [];
        const failed: string[] = [];
        for (const id of picked) {
          const label = receipts.find((r) => r.id === id)?.number ?? id;
          const r = await convertReceiptToInvoiceAction(id, date, notes || undefined);
          if (r.ok) done.push(label);
          else failed.push(`${label}: ${r.error ?? "تعذّر الحفظ"}`);
        }
        // Say exactly what happened. A partial run reported as success is how a missing
        // invoice goes unnoticed until the supplier chases it.
        if (done.length) toast.success(`اتعملت ${done.length} مسودة فاتورة`);
        if (failed.length) toast.error(`فشل ${failed.length}: ${failed.join(" · ")}`, { duration: 10000 });
        if (done.length) { router.push("/purchases/invoices"); router.refresh(); }
      });
    }

    if (!preview || preview.lines.length === 0) return toast.error("لا توجد بنود للفوترة");
    // Nothing to validate when the rate is inherited — it was already approved upstream.
    if (!inherited && needsOwnRate && isForeign && (!exchangeRate || rate <= 0)) return toast.error("أدخل سعر الصرف");
    start(async () => {
      const r = await convertReceiptToInvoiceAction(
        receiptId, date, notes || undefined,
        inherited ? undefined : currencyCode,
        inherited ? undefined : (isForeign ? rate : undefined),
      );
      if (r.ok) {
        toast.success("تم حفظ الفاتورة (مسودة) — رحّلها لاعتمادها");
        router.push(r.invoiceId ? `/purchases/invoices/${r.invoiceId}` : "/purchases/invoices");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات فاتورة الشراء</CardTitle>
          <div className="flex gap-2">
            {/* One receipt needs its preview loaded before saving; several are raised
                without one, so gate on the selection instead of on the preview. */}
            <Button size="sm" onClick={submit} disabled={pending || (picked.length === 1 ? !preview : picked.length === 0)}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              {picked.length > 1 ? `حفظ ${picked.length} فاتورة` : "حفظ الفاتورة"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/purchases/invoices")}>إلغاء</Button>
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
            <CellCombobox
              selectedLabel={supplierLabelById.get(supplierId) ?? ""}
              options={supplierOptions}
              onSelect={(id) => onSupplier(id)}
              placeholder="ابحث عن المورد…"
            />
          </div>
          <div className="space-y-2"><Label>تاريخ الفاتورة</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        {/* The approved rate, inherited — or, for a receipt that carries none, chosen here. */}
        {inherited ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-xl border bg-muted/20 p-3">
            <div className="space-y-1">
              <Label>عملة الفاتورة</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{inherited.code}</div>
            </div>
            <div className="space-y-1">
              <Label>سعر الصرف المعتمد</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium tabular-nums">
                ١ {inherited.code} = {ratef(inherited.rate)} {baseCode}
              </div>
              <p className="text-xs text-muted-foreground">
                {inherited.from ? `سعر معتمد من أمر الشراء ${inherited.from}` : "سعر معتمد من إذن الاستلام"} — مبيتغيّرش هنا
              </p>
            </div>
            {foreignTotal !== null && (
              <div className="flex flex-col justify-end text-sm text-muted-foreground">
                <span>إجمالي بالعملة الأجنبية:</span>
                <span className="text-base font-semibold text-foreground">{fmt(foreignTotal)} {inherited.code}</span>
                <span className="text-xs">(الأستاذ يُسجَّل بـ {baseCode})</span>
              </div>
            )}
          </div>
        ) : needsOwnRate && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-xl border border-dashed bg-muted/20 p-3">
            <div className="space-y-2">
              <Label>عملة الفاتورة</Label>
              <select className={selectCls} value={currencyCode} onChange={(e) => onCurrencyChange(e.target.value)}>
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>{c.code} — {c.nameAr}{c.isBase ? " (أساسية)" : ""}</option>
                ))}
              </select>
            </div>
            {isForeign && (
              <div className="space-y-2">
                <Label>سعر الصرف (1 {shownCurrency} = ؟ {baseCode})</Label>
                <Input type="number" min="0.000001" step="0.000001" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} placeholder="مثال: 3.75" />
                <p className="text-xs text-muted-foreground">الإذن ده مش جاي من أمر شراء، فمفيش سعر معتمد يورثه.</p>
              </div>
            )}
            {isForeign && foreignTotal !== null && (
              <div className="flex flex-col justify-end text-sm text-muted-foreground">
                <span>إجمالي بالعملة الأجنبية:</span>
                <span className="text-base font-semibold text-foreground">{fmt(foreignTotal)} {shownCurrency}</span>
                <span className="text-xs">(الأستاذ يُسجَّل بـ {baseCode})</span>
              </div>
            )}
          </div>
        )}

        {/* Tick one receipt to see it in full before saving, or several to raise a draft
            for each in one pass. Still one invoice per receipt — that is what keeps GRNI
            clearing to the piastre. */}
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>إذون الاستلام</Label>
            <div className="flex items-center gap-2">
              {supplierReceipts.length > 1 && (
                <Button type="button" variant="outline" size="sm"
                  onClick={() => selectReceipts(supplierReceipts.map((r) => r.id))}>
                  اختر الكل ({supplierReceipts.length})
                </Button>
              )}
              {picked.length > 0 && (
                <Button type="button" variant="ghost" size="sm" onClick={() => selectReceipts([])}>
                  امسح الاختيار
                </Button>
              )}
              <span className="text-sm text-muted-foreground">محدَّد {picked.length}</span>
            </div>
          </div>

          {!supplierId ? (
            <p className="text-sm text-muted-foreground">اختر المورد أولاً.</p>
          ) : supplierReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد إذون استلام مؤكَّدة غير مفوترة لهذا المورد.</p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-lg border bg-background">
              {supplierReceipts.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40">
                  <input type="checkbox" className="size-4 rounded border-input"
                    checked={picked.includes(r.id)} onChange={() => toggleReceipt(r.id)} />
                  <span className="font-mono">{r.number}</span>
                  <span className="text-muted-foreground">— {r.dateLabel}</span>
                  {r.exchangeRate > 0 && r.currencyCode !== baseCode && (
                    <span className="text-xs text-muted-foreground">· {r.currencyCode} @ {ratef(r.exchangeRate)}</span>
                  )}
                </label>
              ))}
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            {loading ? <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />جارٍ تحميل بنود الإذن…</span>
              : picked.length > 1 ? `هتتعمل ${picked.length} مسودة فاتورة — واحدة لكل إذن، كل واحدة بسعر صرف إذنها.`
              : "تنزل أصناف الإذن وأسعارها من أمر الشراء في الجدول."}
          </p>
        </div>

        {/* Preview — بيانات الجدول (read-only) */}
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-start">المنتج</TableHead>
                <TableHead className="w-24 text-start">الكمية</TableHead>
                <TableHead className="w-28 text-start">السعر</TableHead>
                <TableHead className="w-28 text-start">شحن/وحدة</TableHead>
                <TableHead className="w-28 text-start">الخصم</TableHead>
                <TableHead className="w-28 text-start">الضريبة</TableHead>
                <TableHead className="w-28 text-start">الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {!preview ? (
                <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  {/* With several receipts ticked there is no single set of lines to show —
                      say that, rather than leaving the table looking broken. */}
                  {picked.length > 1
                    ? `${picked.length} إذون محدَّدة — كل واحد هيطلع مسودة فاتورة بأصنافه. علّم على إذن واحد بس لو عايز تشوف البنود قبل الحفظ.`
                    : "اختر المورد ثم علّم على إذن استلام لعرض البنود."}
                </TableCell></TableRow>
              ) : preview.lines.map((l) => (
                <TableRow key={l.itemId}>
                  <TableCell className="max-w-[22rem] whitespace-normal"><div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{l.name}</div><div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.code}</div></TableCell>
                  <TableCell>{qtyf(l.quantity)}</TableCell>
                  <TableCell>{fmt(l.unitPrice)}</TableCell>
                  <TableCell>{fmt(l.shippingPerUnit)}</TableCell>
                  <TableCell>{fmt(l.discountAmount)}</TableCell>
                  <TableCell>{fmt(l.taxAmount)}</TableCell>
                  <TableCell className="font-medium">{fmt(l.totalAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            {preview && (
              <TableFooter>
                <TableRow className="font-bold"><TableCell colSpan={6}>الإجمالي</TableCell><TableCell>{fmt(preview.total)}</TableCell></TableRow>
              </TableFooter>
            )}
          </Table>
        </div>

        {preview && (
          <div className="flex flex-col items-end gap-1 text-sm">
            <div>الإجمالي الفرعي: <span className="font-medium">{fmt(preview.subtotal)}</span></div>
            <div>الشحن: <span className="font-medium">{fmt(preview.shipping)}</span></div>
            <div>الخصم: <span className="font-medium">{fmt(preview.discount)}</span></div>
            <div>الضريبة: <span className="font-medium">{fmt(preview.tax)}</span></div>
            <div className="text-base font-bold text-primary">
              الإجمالي: {fmt(preview.total)} {baseCode}
              {isForeign && foreignTotal !== null && (
                <span className="ms-2 text-sm font-normal text-muted-foreground">= {fmt(foreignTotal)} {currencyCode}</span>
              )}
            </div>
          </div>
        )}

        <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
      </CardContent>
    </Card>
  );
}
