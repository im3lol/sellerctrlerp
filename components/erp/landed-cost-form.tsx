"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "@/lib/i18n/toast";
import { createLandedCostVoucherAction, updateLandedCostVoucherAction, getLandedCostBasisAction, type LcBasisLine, type LcReceipt } from "@/app/actions/erp/landed-costs";
import { hasPriorLandedCost, matchesLandedSearch } from "@/lib/erp/landed-cost-visibility";
import { allocateVoucherLines, landedLineKey, type VoucherSelection } from "@/lib/erp/landed-cost";
import { round2 } from "@/lib/erp/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { PaginatedTableRows } from "@/components/erp/paginated-table-rows";
import { selectCls } from "@/lib/utils";

type Supplier = { id: string; nameAr: string };
type Receipt = LcReceipt;

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * تكاليف الاستيراد: a freight bill that arrived after the goods. Pick the receipts it
 * covers, enter the charges in EGP, choose how to split them, and the preview shows what
 * each line will carry before anything is saved.
 */
export type LandedCostInitial = {
  id: string; number: string; supplierId: string; date: string; notes: string; receiptIds: string[]; updatedAt: string;
  method: "value" | "qty" | "weight" | "manual";
  shipping: number; customs: number; insurance: number; other: number; selection: VoucherSelection[];
};
export function LandedCostForm({ suppliers, receipts, initial }: { suppliers: Supplier[]; receipts: Receipt[]; initial?: LandedCostInitial }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState(initial?.supplierId ?? "");
  const [date, setDate] = useState(initial?.date ?? today);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [picked, setPicked] = useState<string[]>(initial?.receiptIds ?? []);
  const [receiptFilter, setReceiptFilter] = useState("");
  const [itemFilter, setItemFilter] = useState("");
  const [lines, setLines] = useState<LcBasisLine[]>([]);
  const [charges, setCharges] = useState({ shipping: initial ? String(initial.shipping) : "", customs: initial ? String(initial.customs) : "", insurance: initial ? String(initial.insurance) : "", other: initial ? String(initial.other) : "" });
  const [method, setMethod] = useState<"value" | "qty" | "weight" | "manual">(initial?.method ?? "value");
  const [pricePerKg, setPricePerKg] = useState("");
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const [manual, setManual] = useState<Record<string, string>>({});
  const requestVersion = useRef(0);
  const initialRef = useRef(initial);
  const [basisReady, setBasisReady] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);


  // Every supplier is listed — picking one with no confirmed receipt is a legitimate
  // mistake to make, and the receipts box says so. Those that DO have receipts come
  // first, with the count, so the usual choice is the top of the list.
  const supplierOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of receipts) if (r.supplierId && !r.fullyCosted) counts.set(r.supplierId, (counts.get(r.supplierId) ?? 0) + 1);
    return suppliers
      .map((s) => ({ id: s.id, label: counts.get(s.id) ? fill(t("{0} — {1} إذن"), [t(s.nameAr), counts.get(s.id)]) : s.nameAr, n: counts.get(s.id) ?? 0 }))
      .sort((a, b) => b.n - a.n);
  }, [suppliers, receipts, t]);
  // Every receipt for the supplier stays listed whether ticked or not: removing a row the
  // moment it is ticked makes the list jump under the cursor mid-selection.
  const openReceipts = useMemo(
    () => receipts.filter((r) => r.supplierId === supplierId),
    [receipts, supplierId],
  );
  const visibleReceipts = useMemo(() => {
    const q = receiptFilter.trim().toLowerCase();
    return openReceipts.filter(r => picked.includes(r.id) || (q
      ? matchesLandedSearch(q, r.number, r.date)
      : !r.fullyCosted));
  }, [openReceipts, receiptFilter, picked]);
  const pickedReceipts = useMemo(() => receipts.filter((r) => picked.includes(r.id)), [receipts, picked]);
  const visibleLines = useMemo(() => lines.filter(l => {
    const selected = !!selection[landedLineKey(l)];
    if (onlySelected && !selected) return false;
    if (itemFilter.trim()) return matchesLandedSearch(itemFilter, l.code, l.name, l.receiptNumber);
    return selected || !hasPriorLandedCost(l, initial?.id) || matchesLandedSearch(receiptFilter, l.receiptNumber);
  }), [lines, selection, onlySelected, itemFilter, receiptFilter, initial?.id]);

  const totalWeightKg = useMemo(() => lines.reduce((s, l) => s + (selection[landedLineKey(l)] ? l.quantity * l.weightKg : 0), 0), [lines, selection]);
  const effectiveShipping = method === "weight" && pricePerKg ? round2(Number(pricePerKg) * totalWeightKg) : (Number(charges.shipping) || 0);
  const chargeTotal = round2(effectiveShipping + (Number(charges.customs) || 0) + (Number(charges.insurance) || 0) + (Number(charges.other) || 0));

  const currentSelection = useMemo(() => lines.filter(l => selection[landedLineKey(l)]).map(l => ({
    key: landedLineKey(l), perUnit: Number(manual[landedLineKey(l)] ?? 0),
  })), [lines, selection, manual]);
  const preview = useMemo(() => {
    if (!lines.length) return { rows: [], error: "" };
    try { return { rows: allocateVoucherLines(lines, chargeTotal, method, currentSelection), error: "" }; }
    catch (e) { return { rows: [], error: e instanceof Error ? e.message : "" }; }
  }, [lines, chargeTotal, method, currentSelection]);
  const allocations = new Map(preview.rows.map(l => [landedLineKey(l), l]));
  const total = method === "manual" ? round2(preview.rows.reduce((n, l) => n + l.allocatedAmount, 0)) : chargeTotal;
  const switchMethod = (next: typeof method) => {
    if (next === "manual" && method !== "manual") setManual(Object.fromEntries(lines.map(l => [landedLineKey(l), String(allocations.get(landedLineKey(l))?.perUnit ?? 0)])));
    setMethod(next);
  };
  useEffect(() => {
    if (!initialRef.current) return;
    const ids = initialRef.current.receiptIds;
    const version = ++requestVersion.current;
    startLoad(async () => {
      const r = await getLandedCostBasisAction(ids);
      if (version !== requestVersion.current) return;
      if (!r.ok || !r.lines) { toast.error(r.error ?? "تعذّر تحميل بنود الإذون"); return; }
      const saved = new Map(initialRef.current!.selection.map(l => [l.key, l]));
      setLines(r.lines);
      setSelection(Object.fromEntries(r.lines.map(l => [landedLineKey(l), saved.has(landedLineKey(l))])));
      setManual(Object.fromEntries(r.lines.map(l => [landedLineKey(l), String(saved.get(landedLineKey(l))?.perUnit ?? 0)])));
      setBasisReady(true);
    });
  }, []);
  const pickSupplier = (id: string) => {
    ++requestVersion.current;
    setSelection({}); setManual({}); setBasisReady(false);
    setSupplierId(id);
    setPicked([]);
    setLines([]);
    setReceiptFilter(""); setItemFilter(""); setOnlySelected(false);
  };

  const setPickedAll = (next: string[]) => {
    const version = ++requestVersion.current;
    setPicked(next); setBasisReady(false);
    if (!next.length) { setLines([]); setSelection({}); setManual({}); return; }
    startLoad(async () => {
      const r = await getLandedCostBasisAction(next);
      if (version !== requestVersion.current) return;
      if (!r.ok || !r.lines) { setLines([]); toast.error(r.error ?? t("تعذّر تحميل بنود الإذون")); return; }
      setLines(r.lines);
      setSelection(current => Object.fromEntries(r.lines!.map(l => {
        const key = landedLineKey(l);
        return [key, current[key] ?? !hasPriorLandedCost(l, initial?.id)];
      })));
      setManual(current => Object.fromEntries(r.lines!.map(l => [landedLineKey(l), current[landedLineKey(l)] ?? ""])));
      setBasisReady(true);
    });
  };

  const toggle = (id: string) =>
    setPickedAll(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورّد");
    if (!picked.length) return toast.error("اختر إذن استلام واحد على الأقل");
    if (!basisReady || loading) return;
    if (preview.error) return toast.error(preview.error);
    if (total <= 0) return toast.error("أدخل قيمة التكاليف");
    start(async () => {
      const payload = {
        supplierId, date, method, receiptIds: picked, notes,
        shipping: effectiveShipping, customs: Number(charges.customs) || 0,
        insurance: Number(charges.insurance) || 0, other: Number(charges.other) || 0,
        selection: currentSelection,
        expectedUpdatedAt: initial?.updatedAt,
      };
      const r = initial ? await updateLandedCostVoucherAction(initial.id, payload) : await createLandedCostVoucherAction(payload);
      if (r.ok) {
        toast.success("تم حفظ المستند (مسودة) — راجِعه ثم رحّله");
        router.push(r.number ? `/purchases/landed-costs/${encodeURIComponent(r.number)}` : "/purchases/landed-costs");
        router.refresh();
      } else toast.error(r.error ?? t("تعذّر الحفظ"));
    });
  };

  return (
    <Card>
      <CardHeader data-page-actions="" className="sticky top-16 z-20 rounded-t-xl border-b bg-card/95 py-3 backdrop-blur print:static [&>div]:flex-wrap [&_button]:max-w-full [&_button]:whitespace-normal">
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <CardTitle>{t(initial ? "تعديل تكاليف الاستيراد" : "تكاليف استيراد جديدة")}</CardTitle>
            <CardDescription>{t("فاتورة الشحن/الجمارك بالجنيه المصري، تُوزَّع على إذون الاستلام وتُرفع تكلفة المخزون.")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || loading || !basisReady || !lines.length || !!preview.error}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ المستند")}</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/purchases/landed-costs")}>{t("إلغاء")}</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("المورّد")}</Label>
            <CellCombobox
              selectedLabel={suppliers.find((s) => s.id === supplierId)?.nameAr ?? ""}
              options={supplierOptions}
              onSelect={pickSupplier}
              placeholder={t("ابحث باسم المورّد…")}
            />
          </div>
          <div className="space-y-2"><Label>{t("التاريخ")}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>{t("ملاحظات")}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("اختياري")} /></div>
        </div>

        <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <Label className="text-sm font-semibold">{t("إذون الاستلام المشمولة")}</Label>
          {!supplierId ? (
            <p className="text-sm text-muted-foreground">{t("اختر المورّد أولاً لعرض إذون استلامه المؤكّدة.")}</p>
          ) : !openReceipts.length && !picked.length ? (
            <p className="text-sm text-muted-foreground">{t("لا توجد إذون استلام مؤكّدة لهذا المورّد — التكاليف تُحمَّل على بضاعة مستلَمة فقط.")}</p>
          ) : (
            <div className="space-y-2">
              {/* A freight bill almost always covers several deliveries, so the list ticks:
                  reopening a dropdown once per receipt made the common case the slow one.
                  The search box stays for a supplier with a long history. */}
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  value={receiptFilter}
                  onChange={(e) => setReceiptFilter(e.target.value)}
                  placeholder={t("ابحث برقم الإذن أو التاريخ…")}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setPickedAll([...new Set([...picked, ...visibleReceipts.map((r) => r.id)])])}>
                  {fill(t("اختر الكل ({0})"), [visibleReceipts.length])}
                </Button>
                {picked.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPickedAll([])}>
                    {t("امسح الاختيار")}
                  </Button>
                )}
                <span className="text-sm text-muted-foreground">{t("محدَّد")} {picked.length}</span>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-xl border">
                {visibleReceipts.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">{t("مفيش إذون مطابقة للبحث.")}</p>
                ) : visibleReceipts.map((r) => (
                  <label
                    key={r.id}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="size-4 rounded border-input"
                      checked={picked.includes(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                    <span className="font-mono">{r.number}</span>
                    <span className="text-muted-foreground">— {r.date}</span>
                    {r.fullyCosted && <span className="text-xs text-amber-700">{t("محمّل سابقًا")}</span>}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t("الإذون المحمّلة بالكامل مخفية تلقائيًا. ابحث برقم الإذن لإضافة تكلفة جديدة له.")}</p>
              {pickedReceipts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pickedReceipts.map((r) => (
                    <span key={r.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
                      <span className="font-medium">{r.number}</span>
                      <span className="text-muted-foreground">— {r.date}</span>
                      <button type="button" aria-label={fill(t("إزالة {0}"), [r.number])} className="text-muted-foreground hover:text-destructive" onClick={() => toggle(r.id)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {loading && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("جارٍ تحميل البنود…")}</span>}
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">{t("قيمة التكاليف (بالجنيه المصري)")}</Label>
            {total > 0 && <span className="text-sm text-muted-foreground">{t("الإجمالي:")} <span className="font-medium">{fmt(total)} {t("ج.م")}</span></span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5"><Label className="text-xs">{t("الشحن")}</Label><Input type="number" step="0.01" min="0" disabled={method === "manual"} value={method === "manual" ? String(total) : method === "weight" && pricePerKg ? String(effectiveShipping) : charges.shipping} onChange={(e) => setCharges((c) => ({ ...c, shipping: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">{t("الجمارك")}</Label><Input type="number" step="0.01" min="0" disabled={method === "manual"} value={method === "manual" ? "0" : charges.customs} onChange={(e) => setCharges((c) => ({ ...c, customs: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">{t("التأمين")}</Label><Input type="number" step="0.01" min="0" disabled={method === "manual"} value={method === "manual" ? "0" : charges.insurance} onChange={(e) => setCharges((c) => ({ ...c, insurance: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">{t("أخرى")}</Label><Input type="number" step="0.01" min="0" disabled={method === "manual"} value={method === "manual" ? "0" : charges.other} onChange={(e) => setCharges((c) => ({ ...c, other: e.target.value }))} placeholder="0" /></div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("طريقة التوزيع")}</Label>
              <select className={`${selectCls} min-w-40`} value={method} onChange={(e) => switchMethod(e.target.value as typeof method)}>
                <option value="value">{t("حسب القيمة")}</option>
                <option value="qty">{t("حسب الكمية")}</option>
                <option value="weight">{t("حسب الوزن")}</option>
                <option value="manual">{t("إدخال يدوي لكل صنف")}</option>
              </select>
            </div>
            {method === "weight" && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("سعر الكيلو")}</Label>
                <Input type="number" step="0.01" min="0" className="w-32" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} placeholder={t("مثال: 800")} />
              </div>
            )}
            {method === "weight" && (
              <span className="text-xs text-muted-foreground">{t("إجمالي الوزن")} {qtyf(totalWeightKg)} {t("كجم")}{pricePerKg ? fill(t(" × {0} = {1} ج.م"), [pricePerKg, fmt(round2(Number(pricePerKg) * totalWeightKg))]) : ""}.</span>
            )}
          </div>
        </div>

        {method === "manual" && <p className="text-sm text-muted-foreground">{t("أدخل الشحن لكل وحدة؛ إجمالي الصنف وإجمالي المستند يُحسبان تلقائيًا. الإدخال اليدوي يمثل إجمالي التكلفة الإضافية، ولا يضيف خانات التوزيع بالأعلى.")}</p>}
        {preview.error && lines.length > 0 && <p role="status" className="text-sm text-amber-700">{t(preview.error)}</p>}
        {lines.length > 0 && <div className="flex flex-wrap items-center gap-3">
          <Input className="max-w-sm" value={itemFilter} onChange={e => setItemFilter(e.target.value)} placeholder={t("ابحث بكود الصنف أو اسمه أو رقم الإذن…")} aria-label={t("بحث أصناف تكاليف الاستيراد")} />
          <Button type="button" variant="outline" size="sm" disabled={!visibleLines.length} onClick={() => setSelection(current => ({ ...current, ...Object.fromEntries(visibleLines.map(l => [landedLineKey(l), true])) }))}>{t("اختيار كل الأصناف")}</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setSelection({})}>{t("استبعاد كل الأصناف")}</Button>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlySelected} onChange={e => setOnlySelected(e.target.checked)} />{t("إظهار الأصناف المختارة فقط")}</label>
          <span className="text-sm text-muted-foreground">{fill(t("الأصناف المختارة: {0} من {1}"), [currentSelection.length, lines.length])}</span>
          <p className="w-full text-xs text-muted-foreground">{t("الأصناف المحمّلة سابقًا مخفية تلقائيًا؛ ابحث عنها لإضافة تكلفة جديدة. لتصحيح تكلفة سابقة افتح مستندها. الاختيار الجماعي يخص الأصناف الظاهرة فقط.")}</p>
        </div>}
        {lines.length > 0 && (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("التكلفة")}</TableHead>
                  <TableHead className="text-start">{t("الإذن")}</TableHead>
                  <TableHead className="w-14 text-center">{t("صورة")}</TableHead>
                  <TableHead className="text-start">{t("الصنف")}</TableHead>
                  <TableHead className="text-start">{t("المستودع")}</TableHead>
                  <TableHead className="text-start">{t("الكمية")}</TableHead>
                  <TableHead className="text-start">{t("المتاح الآن")}</TableHead>
                  <TableHead className="text-start">{t("المحمّل سابقًا/وحدة")}</TableHead>
                  <TableHead className="text-start">{t("شحن/وحدة")}</TableHead>
                  <TableHead className="text-start">{t("المحمَّل")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!visibleLines.length && <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">{t("لا توجد أصناف ظاهرة. ابحث عن الصنف المحمّل سابقًا لإضافة تكلفة جديدة له.")}</TableCell></TableRow>}
                <PaginatedTableRows key={`${itemFilter}|${receiptFilter}|${onlySelected}|${picked.join(",")}`} rows={visibleLines.map((l) => {
                  const key = landedLineKey(l);
                  const allocated = allocations.get(key);
                  const sold = Math.max(0, l.quantity - Math.min(l.onHand, l.quantity));
                  return (
                    <TableRow key={key} className={!selection[key] ? "opacity-60" : undefined}>
                      <TableCell><input type="checkbox" aria-label={fill(t("تحميل تكلفة الصنف {0}"), [l.code])} checked={!!selection[key]} onChange={e => setSelection(current => ({ ...current, [key]: e.target.checked }))} /></TableCell>
                      <TableCell className="font-mono text-xs">{l.receiptNumber}</TableCell>
                      <TableCell className="text-center">
                        {/* Fixed box + object-fit so a tall picture cannot stretch the row,
                            and nothing at all when there is no image — a column of
                            placeholders is noise. */}
                        {l.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.image} alt="" className="mx-auto size-9 rounded object-contain" />
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[15rem] max-w-[22rem] whitespace-normal">
                        <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{t(l.name)}</div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.code}</div>
                        {l.vouchers.filter(v => v.id !== initial?.id).map(v => <a key={v.id} href={`/purchases/landed-costs/${encodeURIComponent(v.number)}`} className="mt-1 block text-xs text-primary underline">{v.number} · {t(v.status === "DRAFT" ? "مسودة غير مرحلة" : "مُرحّل")} · {fmt(v.perUnit)}/{t("وحدة")}</a>)}
                      </TableCell>
                      <TableCell>{t(l.warehouseName)}</TableCell>
                      <TableCell>{qtyf(l.quantity)}</TableCell>
                      <TableCell className={sold > 0 ? "text-amber-600" : "text-muted-foreground"}>
                        {qtyf(l.onHand)}{sold > 0 && <span className="block text-xs">{t("مُباع")} {qtyf(sold)} {t("← تكلفة مبيعات")}</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmt(l.previousPerUnit)}</TableCell>
                      <TableCell className="tabular-nums">{method === "manual" ? <Input className="w-32" aria-label={fill(t("شحن لكل وحدة للصنف {0}"), [l.code])} type="number" min="0" step="0.0001" disabled={!selection[key]} value={manual[key] ?? ""} onChange={e => setManual(current => ({ ...current, [key]: e.target.value }))} placeholder="0" /> : fmt(allocated?.perUnit ?? 0)}</TableCell>
                      <TableCell className="font-medium tabular-nums">{fmt(allocated?.allocatedAmount ?? 0)}</TableCell>
                    </TableRow>
                  );
                })} />
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
