"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createLandedCostVoucherAction, getLandedCostBasisAction, type LcBasisLine } from "@/app/actions/erp/landed-costs";
import { allocateLandedPerUnit } from "@/lib/erp/landed-cost";
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
type Receipt = { id: string; number: string; date: string; supplierId: string; supplierName: string };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/**
 * تكاليف الاستيراد: a freight bill that arrived after the goods. Pick the receipts it
 * covers, enter the charges in EGP, choose how to split them, and the preview shows what
 * each line will carry before anything is saved.
 */
export function LandedCostForm({ suppliers, receipts }: { suppliers: Supplier[]; receipts: Receipt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [loading, startLoad] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [receiptFilter, setReceiptFilter] = useState("");
  const [lines, setLines] = useState<LcBasisLine[]>([]);
  const [charges, setCharges] = useState({ shipping: "", customs: "", insurance: "", other: "" });
  const [method, setMethod] = useState<"value" | "qty" | "weight">("value");
  const [pricePerKg, setPricePerKg] = useState("");

  // Every supplier is listed — picking one with no confirmed receipt is a legitimate
  // mistake to make, and the receipts box says so. Those that DO have receipts come
  // first, with the count, so the usual choice is the top of the list.
  const supplierOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of receipts) if (r.supplierId) counts.set(r.supplierId, (counts.get(r.supplierId) ?? 0) + 1);
    return suppliers
      .map((s) => ({ id: s.id, label: counts.get(s.id) ? `${s.nameAr} — ${counts.get(s.id)} إذن` : s.nameAr, n: counts.get(s.id) ?? 0 }))
      .sort((a, b) => b.n - a.n);
  }, [suppliers, receipts]);
  // Every receipt for the supplier stays listed whether ticked or not: removing a row the
  // moment it is ticked makes the list jump under the cursor mid-selection.
  const openReceipts = useMemo(
    () => receipts.filter((r) => r.supplierId === supplierId),
    [receipts, supplierId],
  );
  const visibleReceipts = useMemo(() => {
    const q = receiptFilter.trim().toLowerCase();
    return q ? openReceipts.filter((r) => `${r.number} ${r.date}`.toLowerCase().includes(q)) : openReceipts;
  }, [openReceipts, receiptFilter]);
  const pickedReceipts = useMemo(() => receipts.filter((r) => picked.includes(r.id)), [receipts, picked]);

  const total = round2((Number(charges.shipping) || 0) + (Number(charges.customs) || 0) + (Number(charges.insurance) || 0) + (Number(charges.other) || 0));

  const totalWeightKg = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.weightKg, 0), [lines]);
  useEffect(() => {
    if (method !== "weight" || !pricePerKg) return;
    setCharges((c) => ({ ...c, shipping: String(round2(Number(pricePerKg) * totalWeightKg)) }));
  }, [method, pricePerKg, totalWeightKg]);

  // Same allocator the server re-runs on save, so the preview can't drift from the result.
  const perUnit = useMemo(
    () => allocateLandedPerUnit(lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, weight: l.weightKg, eligible: true })), total, method),
    [lines, total, method],
  );

  const pickSupplier = (id: string) => {
    setSupplierId(id);
    setPicked([]);
    setLines([]);
  };

  const setPickedAll = (next: string[]) => {
    setPicked(next);
    if (!next.length) { setLines([]); return; }
    startLoad(async () => {
      const r = await getLandedCostBasisAction(next);
      if (!r.ok || !r.lines) { toast.error(r.error ?? "تعذّر تحميل بنود الإذون"); return; }
      setLines(r.lines);
    });
  };

  const toggle = (id: string) =>
    setPickedAll(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);

  const submit = () => {
    if (!supplierId) return toast.error("اختر المورّد");
    if (!picked.length) return toast.error("اختر إذن استلام واحد على الأقل");
    if (total <= 0) return toast.error("أدخل قيمة التكاليف");
    start(async () => {
      const r = await createLandedCostVoucherAction({
        supplierId, date, method, receiptIds: picked, notes,
        shipping: Number(charges.shipping) || 0, customs: Number(charges.customs) || 0,
        insurance: Number(charges.insurance) || 0, other: Number(charges.other) || 0,
      });
      if (r.ok) {
        toast.success("تم حفظ المستند (مسودة) — راجِعه ثم رحّله");
        router.push(r.number ? `/purchases/landed-costs/${encodeURIComponent(r.number)}` : "/purchases/landed-costs");
        router.refresh();
      } else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <CardTitle>تكاليف استيراد جديدة</CardTitle>
            <CardDescription>فاتورة الشحن/الجمارك بالجنيه المصري، تُوزَّع على إذون الاستلام وتُرفع تكلفة المخزون.</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending || !lines.length}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ المستند</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/purchases/landed-costs")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>المورّد</Label>
            <CellCombobox
              selectedLabel={suppliers.find((s) => s.id === supplierId)?.nameAr ?? ""}
              options={supplierOptions}
              onSelect={pickSupplier}
              placeholder="ابحث باسم المورّد…"
            />
          </div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div className="space-y-2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
        </div>

        <div className="space-y-2 rounded-xl border bg-muted/30 p-4">
          <Label className="text-sm font-semibold">إذون الاستلام المشمولة</Label>
          {!supplierId ? (
            <p className="text-sm text-muted-foreground">اختر المورّد أولاً لعرض إذون استلامه المؤكّدة.</p>
          ) : !openReceipts.length && !picked.length ? (
            <p className="text-sm text-muted-foreground">لا توجد إذون استلام مؤكّدة لهذا المورّد — التكاليف تُحمَّل على بضاعة مستلَمة فقط.</p>
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
                  placeholder="ابحث برقم الإذن أو التاريخ…"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setPickedAll(visibleReceipts.map((r) => r.id))}>
                  اختر الكل ({visibleReceipts.length})
                </Button>
                {picked.length > 0 && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPickedAll([])}>
                    امسح الاختيار
                  </Button>
                )}
                <span className="text-sm text-muted-foreground">محدَّد {picked.length}</span>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-xl border">
                {visibleReceipts.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">مفيش إذون مطابقة للبحث.</p>
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
                  </label>
                ))}
              </div>
              {pickedReceipts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pickedReceipts.map((r) => (
                    <span key={r.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
                      <span className="font-medium">{r.number}</span>
                      <span className="text-muted-foreground">— {r.date}</span>
                      <button type="button" aria-label={`إزالة ${r.number}`} className="text-muted-foreground hover:text-destructive" onClick={() => toggle(r.id)}>×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {loading && <span className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />جارٍ تحميل البنود…</span>}
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">قيمة التكاليف (بالجنيه المصري)</Label>
            {total > 0 && <span className="text-sm text-muted-foreground">الإجمالي: <span className="font-medium">{fmt(total)} ج.م</span></span>}
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5"><Label className="text-xs">الشحن</Label><Input type="number" step="0.01" min="0" value={charges.shipping} onChange={(e) => setCharges((c) => ({ ...c, shipping: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">الجمارك</Label><Input type="number" step="0.01" min="0" value={charges.customs} onChange={(e) => setCharges((c) => ({ ...c, customs: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">التأمين</Label><Input type="number" step="0.01" min="0" value={charges.insurance} onChange={(e) => setCharges((c) => ({ ...c, insurance: e.target.value }))} placeholder="0" /></div>
            <div className="space-y-1.5"><Label className="text-xs">أخرى</Label><Input type="number" step="0.01" min="0" value={charges.other} onChange={(e) => setCharges((c) => ({ ...c, other: e.target.value }))} placeholder="0" /></div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">طريقة التوزيع</Label>
              <select className={`${selectCls} min-w-40`} value={method} onChange={(e) => setMethod(e.target.value as "value" | "qty" | "weight")}>
                <option value="value">حسب القيمة</option>
                <option value="qty">حسب الكمية</option>
                <option value="weight">حسب الوزن</option>
              </select>
            </div>
            {method === "weight" && (
              <div className="space-y-1.5">
                <Label className="text-xs">سعر الكيلو</Label>
                <Input type="number" step="0.01" min="0" className="w-32" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} placeholder="مثال: 800" />
              </div>
            )}
            {method === "weight" && (
              <span className="text-xs text-muted-foreground">إجمالي الوزن {qtyf(totalWeightKg)} كجم{pricePerKg ? ` × ${pricePerKg} = ${fmt(round2(Number(pricePerKg) * totalWeightKg))} ج.م` : ""}.</span>
            )}
          </div>
        </div>

        {lines.length > 0 && (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الإذن</TableHead>
                  <TableHead className="w-14 text-center">صورة</TableHead>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="text-start">المستودع</TableHead>
                  <TableHead className="text-start">الكمية</TableHead>
                  <TableHead className="text-start">المتاح الآن</TableHead>
                  <TableHead className="text-start">شحن/وحدة</TableHead>
                  <TableHead className="text-start">المحمَّل</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <PaginatedTableRows rows={lines.map((l, i) => {
                  const sold = Math.max(0, l.quantity - Math.min(l.onHand, l.quantity));
                  return (
                    <TableRow key={`${l.purchaseReceiptId}|${l.itemId}|${l.warehouseId}`}>
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
                      <TableCell className="max-w-[22rem] whitespace-normal">
                        <div dir="ltr" className="line-clamp-2 text-start leading-snug" title={l.name}>{l.name}</div>
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{l.code}</div>
                      </TableCell>
                      <TableCell>{l.warehouseName}</TableCell>
                      <TableCell>{qtyf(l.quantity)}</TableCell>
                      <TableCell className={sold > 0 ? "text-amber-600" : "text-muted-foreground"}>
                        {qtyf(l.onHand)}{sold > 0 && <span className="block text-xs">مُباع {qtyf(sold)} ← تكلفة مبيعات</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{fmt(perUnit[i] ?? 0)}</TableCell>
                      <TableCell className="font-medium tabular-nums">{fmt(round2((perUnit[i] ?? 0) * l.quantity))}</TableCell>
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
