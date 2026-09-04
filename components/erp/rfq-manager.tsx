"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  listRfqsAction, saveRfqAction, sendRfqAction, cancelRfqAction, getRfqAction,
  saveQuoteAction, awardRfqAction, type RfqDetail,
} from "@/app/actions/erp/rfqs";
import { validateRfq } from "@/lib/erp/rfq";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { CellCombobox } from "@/components/erp/cell-combobox";

export type Option = { id: string; label: string };
type ListRow = NonNullable<Awaited<ReturnType<typeof listRfqsAction>>["rows"]>[number];
type Draft = { itemId: string; quantity: number };

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS: Record<string, { label: string; tone: "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "مسودة", tone: "outline" },
  SENT: { label: "مُرسل", tone: "outline" },
  AWARDED: { label: "مُرسى", tone: "secondary" },
  CANCELLED: { label: "ملغي", tone: "destructive" },
};

/**
 * Requests for quotation and the comparison that follows. The matrix is the point: one
 * row per item, one column per supplier, the cheapest price on each line marked. A
 * partial quote is labelled as such — it usually shows the lowest total, and treating
 * that as "cheapest" is how the wrong supplier wins.
 */
export function RfqManager({ items, suppliers, warehouses, canManage }: {
  items: Option[]; suppliers: Option[]; warehouses: Option[]; canManage: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, start] = useTransition();

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ date: string; dueDate: string; lines: Draft[]; supplierIds: string[]; notes: string }>({
    date: new Date().toISOString().slice(0, 10), dueDate: "", lines: [{ itemId: "", quantity: 1 }], supplierIds: [], notes: "",
  });

  const [open, setOpen] = useState<RfqDetail | null>(null);
  const [quoting, setQuoting] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ leadDays: string; terms: string; prices: Record<string, string> }>({ leadDays: "", terms: "", prices: {} });
  const [awardWarehouse, setAwardWarehouse] = useState("");

  const load = () => {
    setLoading(true);
    void listRfqsAction().then((r) => {
      setLoading(false);
      if (!r.ok) { toast.error(r.error ?? "تعذّر التحميل"); return; }
      setRows(r.rows ?? []);
    });
  };
  useEffect(() => { load(); }, []);

  const openRfq = (id: string) =>
    void getRfqAction(id).then((r) => {
      if (!r.ok || !r.detail) { toast.error(r.error ?? "تعذّر الفتح"); return; }
      setOpen(r.detail);
      setCreating(false);
      setQuoting(null);
    });

  const saveDraft = () => {
    const lines = draft.lines.filter((l) => l.itemId);
    const err = validateRfq({ lines, supplierIds: draft.supplierIds });
    if (err) return toast.error(err);
    start(async () => {
      const r = await saveRfqAction({
        date: draft.date, dueDate: draft.dueDate || null, notes: draft.notes || null,
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity })),
        supplierIds: draft.supplierIds,
      });
      if (!r.ok) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
      toast.success(`تم حفظ ${r.number ?? "الطلب"}`);
      setCreating(false);
      setDraft({ date: new Date().toISOString().slice(0, 10), dueDate: "", lines: [{ itemId: "", quantity: 1 }], supplierIds: [], notes: "" });
      load();
      if (r.id) openRfq(r.id);
    });
  };

  const send = (id: string) =>
    start(async () => {
      const r = await sendRfqAction(id);
      if (r.ok) { toast.success("الطلب مُرسل — سجّل عروض الموردين لما توصل"); load(); openRfq(id); }
      else toast.error(r.error ?? "تعذّر الإرسال");
    });

  const cancel = (row: ListRow) =>
    void (async () => {
      const go = await confirm({ danger: true, title: `إلغاء ${row.number}؟`, description: "الطلب هيتقفل من غير ترسية.", confirmText: "ألغِ", cancelText: "رجوع" });
      if (!go) return;
      start(async () => {
        const r = await cancelRfqAction(row.id);
        if (r.ok) { toast.success("تم الإلغاء"); load(); setOpen(null); }
        else toast.error(r.error ?? "تعذّر الإلغاء");
      });
    })();

  const startQuote = (rfqSupplierId: string) => {
    if (!open) return;
    const s = open.comparison.suppliers.find((x) => x.id === rfqSupplierId);
    setQuoting(rfqSupplierId);
    setQuote({
      leadDays: s?.leadDays != null ? String(s.leadDays) : "",
      terms: s?.paymentTermDays != null ? String(s.paymentTermDays) : "",
      prices: Object.fromEntries(open.lines.map((l) => [l.id, s?.prices[l.id] != null ? String(s!.prices[l.id]) : ""])),
    });
  };

  const submitQuote = (declined = false) => {
    if (!quoting || !open) return;
    start(async () => {
      const r = await saveQuoteAction({
        rfqSupplierId: quoting,
        leadDays: quote.leadDays ? Number(quote.leadDays) : null,
        paymentTermDays: quote.terms ? Number(quote.terms) : null,
        declined,
        prices: open.lines.map((l) => ({ rfqLineId: l.id, unitPrice: Number(quote.prices[l.id]) || 0 })),
      });
      if (r.ok) { toast.success(declined ? "تم تسجيل الاعتذار" : "تم حفظ العرض"); setQuoting(null); openRfq(open.rfq.id); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  const award = (rfqSupplierId: string) =>
    void (async () => {
      if (!open) return;
      if (!awardWarehouse) return toast.error("اختر المستودع اللي هيستلم");
      const s = open.comparison.suppliers.find((x) => x.id === rfqSupplierId);
      const go = await confirm({
        title: `ترسية على ${s?.supplierName ?? ""}؟`,
        description: `هيتعمل أمر شراء مسودة بأسعار العرض (${money(s?.total ?? 0)}) ويقفل الطلب.`,
        confirmText: "رسِّ وأنشئ الأمر", cancelText: "رجوع",
      });
      if (!go) return;
      start(async () => {
        const r = await awardRfqAction(open.rfq.id, rfqSupplierId, awardWarehouse);
        if (r.ok) { toast.success("تمت الترسية — راجع أمر الشراء"); router.push(r.orderId ? `/purchases/orders/${r.orderId}` : "/purchases/orders"); }
        else toast.error(r.error ?? "تعذّر الترسية");
      });
    })();

  // ── the comparison matrix ────────────────────────────────────────────
  if (open) {
    const c = open.comparison;
    const editable = open.rfq.status === "SENT" || open.rfq.status === "DRAFT";
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex w-full flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{open.rfq.number}</CardTitle>
                <CardDescription>
                  {open.lines.length} صنف · {c.suppliers.length} مورّد ·{" "}
                  {c.suppliers.filter((s) => s.quotedLines > 0).length} عرض وصل
                  {open.rfq.dueDate ? ` · الردود لحد ${open.rfq.dueDate}` : ""}
                </CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={STATUS[open.rfq.status]?.tone ?? "outline"}>{STATUS[open.rfq.status]?.label ?? open.rfq.status}</Badge>
                {canManage && open.rfq.status === "DRAFT" && (
                  <Button size="sm" onClick={() => send(open.rfq.id)} disabled={pending}>
                    <Icon name="Send" className="size-4" />أرسل
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setOpen(null)}>رجوع</Button>
              </div>
            </div>
          </CardHeader>
          {(c.recommendedId || c.bestOfBreedTotal != null) && (
            <CardContent className="flex flex-wrap gap-6 text-sm">
              {c.recommendedId && (
                <div>
                  <div className="text-muted-foreground">الأفضل (عرض كامل)</div>
                  <div className="font-bold">
                    {c.suppliers.find((s) => s.id === c.recommendedId)?.supplierName} — {money(c.suppliers.find((s) => s.id === c.recommendedId)?.total ?? 0)}
                  </div>
                </div>
              )}
              {c.spread != null && c.spread > 0 && (
                <div>
                  <div className="text-muted-foreground">الفرق عن أغلى عرض كامل</div>
                  <div className="font-bold text-emerald-600">{money(c.spread)}</div>
                </div>
              )}
              {c.bestOfBreedTotal != null && (
                <div>
                  <div className="text-muted-foreground">لو أخدت كل صنف من الأرخص</div>
                  <div className="font-bold">{money(c.bestOfBreedTotal)}</div>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>جدول المقارنة</CardTitle>
            <CardDescription>الأرخص في كل سطر معلَّم. العرض الناقص مكتوب عليه كده — إجماليه أقل لأنه مسعّرش كل حاجة.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">الصنف</TableHead>
                    <TableHead className="text-start">الكمية</TableHead>
                    {c.suppliers.map((s) => (
                      <TableHead key={s.id} className="text-start">
                        <div className="font-medium">{s.supplierName}</div>
                        <div className="text-xs font-normal text-muted-foreground">
                          {s.status === "DECLINED" ? "اعتذر" : s.quotedLines === 0 ? "لسه مردّش" : s.complete ? "عرض كامل" : `ناقص (${s.quotedLines}/${open.lines.length})`}
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <div className="font-medium">{l.name}</div>
                        <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                      </TableCell>
                      <TableCell className="tabular-nums">{l.quantity}</TableCell>
                      {c.suppliers.map((s) => {
                        const p = s.prices[l.id];
                        const best = c.bestPerLine[l.id]?.rfqSupplierId === s.id;
                        return (
                          <TableCell key={s.id} className={`tabular-nums ${best ? "font-bold text-emerald-600" : ""}`}>
                            {p == null ? <span className="text-muted-foreground">—</span> : money(p)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/40 font-bold">
                    <TableCell colSpan={2}>الإجمالي</TableCell>
                    {c.suppliers.map((s) => (
                      <TableCell key={s.id} className="tabular-nums">
                        {s.quotedLines === 0 ? "—" : money(s.total)}
                        {s.rank === 1 && <Badge className="ms-2" variant="secondary">الأفضل</Badge>}
                      </TableCell>
                    ))}
                  </TableRow>
                  <TableRow>
                    <TableCell colSpan={2} className="text-muted-foreground">التوريد / السداد</TableCell>
                    {c.suppliers.map((s) => (
                      <TableCell key={s.id} className="text-xs text-muted-foreground">
                        {s.leadDays != null ? `${s.leadDays} يوم` : "—"} · {s.paymentTermDays != null ? `${s.paymentTermDays} يوم سداد` : "—"}
                      </TableCell>
                    ))}
                  </TableRow>
                  {canManage && (
                    <TableRow>
                      <TableCell colSpan={2} />
                      {c.suppliers.map((s) => (
                        <TableCell key={s.id} className="space-y-1">
                          {editable && <Button size="sm" variant="outline" onClick={() => startQuote(s.id)}>سجّل عرضه</Button>}
                          {open.rfq.status !== "AWARDED" && s.complete && (
                            <Button size="sm" onClick={() => award(s.id)} disabled={pending}>رسِّ عليه</Button>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {canManage && open.rfq.status !== "AWARDED" && (
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="space-y-2">
                  <Label>المستودع المستلم (للترسية)</Label>
                  <CellCombobox
                    selectedLabel={warehouses.find((w) => w.id === awardWarehouse)?.label ?? ""}
                    options={warehouses} onSelect={setAwardWarehouse} placeholder="اختر المستودع…"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {quoting && (
          <Card>
            <CardHeader>
              <div className="flex w-full flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle>عرض {c.suppliers.find((s) => s.id === quoting)?.supplierName}</CardTitle>
                  <CardDescription>اكتب السعر لكل صنف. سيبه فاضي لو المورّد مسعّرش الصنف ده.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => submitQuote(false)} disabled={pending}><Icon name="Check" className="size-4" />حفظ</Button>
                  <Button size="sm" variant="outline" onClick={() => submitQuote(true)} disabled={pending}>اعتذر</Button>
                  <Button size="sm" variant="ghost" onClick={() => setQuoting(null)}>إغلاق</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-4">
                <div className="space-y-2"><Label>مدة التوريد (يوم)</Label>
                  <Input type="number" min="0" className="w-32" value={quote.leadDays} onChange={(e) => setQuote((q) => ({ ...q, leadDays: e.target.value }))} /></div>
                <div className="space-y-2"><Label>مدة السداد (يوم)</Label>
                  <Input type="number" min="0" className="w-32" value={quote.terms} onChange={(e) => setQuote((q) => ({ ...q, terms: e.target.value }))} /></div>
              </div>
              <div className="rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الصنف</TableHead>
                      <TableHead className="text-start">الكمية</TableHead>
                      <TableHead className="w-36 text-start">سعر الوحدة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {open.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell>{l.name}</TableCell>
                        <TableCell className="tabular-nums">{l.quantity}</TableCell>
                        <TableCell>
                          <Input type="number" step="0.01" min="0" className="w-32 tabular-nums"
                            value={quote.prices[l.id] ?? ""}
                            onChange={(e) => setQuote((q) => ({ ...q, prices: { ...q.prices, [l.id]: e.target.value } }))} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // ── new request ──────────────────────────────────────────────────────
  if (creating) {
    return (
      <Card>
        <CardHeader>
          <div className="flex w-full flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>طلب عروض جديد</CardTitle>
              <CardDescription>نفس السلة بتروح لكل المورّدين، فالمقارنة بتبقى عادلة.</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={saveDraft} disabled={pending}><Icon name="Check" className="size-4" />حفظ</Button>
              <Button size="sm" variant="outline" onClick={() => setCreating(false)}>إلغاء</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2"><Label>التاريخ</Label>
              <Input type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} /></div>
            <div className="space-y-2"><Label>آخر موعد للردود</Label>
              <Input type="date" value={draft.dueDate} onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value }))} /></div>
            <div className="space-y-2"><Label>ملاحظات</Label>
              <Input value={draft.notes} onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="اختياري" /></div>
          </div>

          <div className="space-y-2">
            <Label>الموردون المدعوّون</Label>
            <div className="max-w-md">
              <CellCombobox
                selectedLabel=""
                options={suppliers.filter((s) => !draft.supplierIds.includes(s.id))}
                onSelect={(id) => setDraft((d) => ({ ...d, supplierIds: [...d.supplierIds, id] }))}
                placeholder={suppliers.length ? "أضِف مورّد…" : "مفيش موردين"}
              />
            </div>
            {draft.supplierIds.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {draft.supplierIds.map((id) => (
                  <span key={id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-sm">
                    {suppliers.find((s) => s.id === id)?.label ?? id}
                    <button type="button" aria-label="إزالة" className="text-muted-foreground hover:text-destructive"
                      onClick={() => setDraft((d) => ({ ...d, supplierIds: d.supplierIds.filter((x) => x !== id) }))}>×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الصنف</TableHead>
                  <TableHead className="w-32 text-start">الكمية</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {draft.lines.map((l, i) => (
                  <TableRow key={i}>
                    <TableCell className="min-w-64">
                      <CellCombobox
                        selectedLabel={items.find((it) => it.id === l.itemId)?.label ?? ""}
                        options={items}
                        onSelect={(id) => setDraft((d) => ({ ...d, lines: d.lines.map((x, k) => (k === i ? { ...x, itemId: id } : x)) }))}
                        placeholder="ابحث عن الصنف…"
                      />
                    </TableCell>
                    <TableCell>
                      <Input type="number" step="any" min="0" className="w-28 tabular-nums" value={l.quantity}
                        onChange={(e) => setDraft((d) => ({ ...d, lines: d.lines.map((x, k) => (k === i ? { ...x, quantity: Number(e.target.value) || 0 } : x)) }))} />
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" aria-label="حذف"
                        onClick={() => setDraft((d) => ({ ...d, lines: d.lines.filter((_, k) => k !== i) }))}>
                        <Icon name="Trash2" className="size-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button size="sm" variant="outline" onClick={() => setDraft((d) => ({ ...d, lines: [...d.lines, { itemId: "", quantity: 1 }] }))}>
            <Icon name="Plus" className="size-4" />صنف
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ── list ─────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <div className="flex w-full flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>طلبات عروض الأسعار</CardTitle>
            <CardDescription>{loading ? "جارٍ التحميل…" : `${rows.length} طلب`}</CardDescription>
          </div>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)}><Icon name="Plus" className="size-4" />طلب جديد</Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !loading ? (
          <p className="text-sm text-muted-foreground">
            مفيش طلبات. الطلب بيبعت نفس السلة لكذا مورّد، وبعدين تقارن ردودهم في جدول واحد بدل ما تفضل تقلّب في الواتساب.
          </p>
        ) : (
          <div className="rounded-xl border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">الأصناف</TableHead>
                  <TableHead className="text-start">الردود</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.number}</TableCell>
                    <TableCell className="text-xs" dir="ltr">{r.date}</TableCell>
                    <TableCell className="tabular-nums">{r.lines}</TableCell>
                    <TableCell className="tabular-nums">{r.quoted} / {r.invited}</TableCell>
                    <TableCell><Badge variant={STATUS[r.status]?.tone ?? "outline"}>{STATUS[r.status]?.label ?? r.status}</Badge></TableCell>
                    <TableCell className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => openRfq(r.id)}>افتح</Button>
                      {canManage && r.status !== "AWARDED" && r.status !== "CANCELLED" && (
                        <Button size="icon" variant="ghost" aria-label="إلغاء" onClick={() => cancel(r)}>
                          <Icon name="Ban" className="size-4 text-destructive" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
