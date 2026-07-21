"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { confirm } from "@/components/erp/confirm";
import {
  saveOpeningBalanceAction, postOpeningBalanceAction, reverseOpeningBalanceAction,
  searchItemsAction, parseOpeningCsvAction,
} from "@/app/actions/erp/opening-balance";
import { totals, validateOpening, OPENING_EQUITY_CODE, type OpeningKind, type OpeningLine } from "@/lib/erp/opening-balance";
import { cn } from "@/lib/utils";

export type Opt = { id: string; label: string };
type Row = {
  key: number;
  kind: OpeningKind;
  ref: string; refLabel: string;
  warehouseId: string; warehouseLabel: string;
  debit: string; credit: string; quantity: string; unitCost: string;
  reference: string; dueDate: string; // CUSTOMER/SUPPLIER
};
type CsvRow = Awaited<ReturnType<typeof parseOpeningCsvAction>>[number];

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let KEY = 0;
const blank = (kind: OpeningKind): Row =>
  ({ key: ++KEY, kind, ref: "", refLabel: "", warehouseId: "", warehouseLabel: "", debit: "", credit: "", quantity: "", unitCost: "", reference: "", dueDate: "" });

/** In-cell item picker backed by a server search — the catalog is too large to ship. */
function ItemPicker({ label, onPick }: { label: string; onPick: (id: string, label: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ id: string; code: string; nameAr: string | null }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || q.trim().length < 1) { setRows([]); return; }
    let alive = true;
    const t = setTimeout(async () => { const r = await searchItemsAction(q); if (alive) setRows(r); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div ref={box} className="relative">
      <Input value={open ? q : label} placeholder="ابحث بالكود أو الاسم…" onFocus={() => { setOpen(true); setQ(""); }}
        onChange={(e) => setQ(e.target.value)} />
      {open && rows.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-64 w-72 overflow-auto rounded-md border bg-popover p-1 shadow-lg">
          {rows.map((r) => (
            <button key={r.id} type="button" className="flex w-full flex-col items-start gap-0.5 rounded-sm px-3 py-1.5 text-start text-sm hover:bg-accent"
              onClick={() => { onPick(r.id, `${r.code} — ${r.nameAr ?? ""}`); setOpen(false); }}>
              <span className="font-mono text-xs" dir="ltr">{r.code}</span>
              <span className="line-clamp-1">{r.nameAr}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CSV_COLS: Record<OpeningKind, string> = {
  ACCOUNT: "الأعمدة: كود الحساب · مدين · دائن",
  CUSTOMER: "الأعمدة: كود العميل · رقم الفاتورة · تاريخ الاستحقاق · المبلغ",
  SUPPLIER: "الأعمدة: كود المورّد · رقم الفاتورة · تاريخ الاستحقاق · المبلغ",
  ITEM: "الأعمدة: الكود/SKU · المخزن · الكمية · التكلفة",
};
const CSV_TEMPLATE: Record<OpeningKind, string> = {
  ACCOUNT: "code,debit,credit\n1101,5000,0\n",
  CUSTOMER: "code,reference,due_date,amount\nC-001,INV-100,2026-02-01,1500\n",
  SUPPLIER: "code,reference,due_date,amount\nS-001,BILL-55,2026-02-01,900\n",
  ITEM: "code,warehouse,quantity,unit_cost\nSKU-001,المخزن الرئيسي,10,25.50\n",
};

/** CSV import + match preview for a section — upload, review matched/unmatched, add. */
function CsvImport({ kind, onAdd }: { kind: OpeningKind; onAdd: (rows: CsvRow[]) => void }) {
  const [pending, start] = useTransition();
  const [preview, setPreview] = useState<CsvRow[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = (f: File) => {
    const rd = new FileReader();
    rd.onload = () => start(async () => {
      const r = await parseOpeningCsvAction(kind, String(rd.result ?? ""));
      if (!r.length) { toast.error("الملف فارغ أو غير صالح"); return; }
      setPreview(r);
    });
    rd.readAsText(f);
  };
  const apply = () => {
    const ok = (preview ?? []).filter((p) => !p.error && p.refId);
    if (!ok.length) { toast.error("لا توجد صفوف صالحة"); return; }
    onAdd(ok); setPreview(null); toast.success(`تمت إضافة ${ok.length} سطر`);
  };
  const dl = () => {
    const blob = new Blob(["﻿" + CSV_TEMPLATE[kind]], { type: "text/csv;charset=utf-8" });
    const u = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = u; a.download = `opening-${kind.toLowerCase()}-template.csv`; a.click(); URL.revokeObjectURL(u);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => fileRef.current?.click()}><Icon name="Upload" className="size-4" /> استيراد CSV</Button>
        <Button type="button" variant="ghost" size="sm" onClick={dl}><Icon name="Download" className="size-4" /> قالب</Button>
        <span className="text-xs text-muted-foreground">{CSV_COLS[kind]}</span>
      </div>
      {preview && (
        <div className="rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2 text-sm">
            <span>معاينة — {preview.filter((p) => !p.error).length} صالح · {preview.filter((p) => p.error).length} خطأ</span>
            <div className="flex gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setPreview(null)}>إلغاء</Button><Button type="button" size="sm" onClick={apply}>إضافة الصالح</Button></div>
          </div>
          <div className="max-h-64 overflow-auto"><table className="w-full text-xs">
            <thead className="text-right text-muted-foreground"><tr><th className="p-2">الكود</th><th className="p-2">المطابقة</th><th className="p-2">القيمة</th><th className="p-2">الحالة</th></tr></thead>
            <tbody>{preview.slice(0, 300).map((p, i) => (
              <tr key={i} className="border-t">
                <td className="p-2 font-mono" dir="ltr">{p.code}</td><td className="p-2">{p.name ?? "—"}</td>
                <td className="p-2 tabular-nums">{kind === "ITEM" ? `${p.quantity} × ${money(p.unitCost)}` : kind === "ACCOUNT" ? `${money(p.debit)} / ${money(p.credit)}` : money(p.amount)}</td>
                <td className="p-2">{p.error ? <span className="text-destructive">{p.error}</span> : <span className="text-emerald-600">مطابَق</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}

/**
 * The migration screen — professional (Odoo/ERPNext-style): four focused sections
 * (accounts, customer invoices, supplier invoices, opening stock) balancing against
 * the Opening Balance Equity account, with a live balance check and CSV import.
 * Totals/validation run through the same pure functions the server posts with.
 */
export function OpeningBalanceEditor({ postedId, reversible, date: initialDate, initial, accounts, customers, suppliers, warehouses }: {
  postedId: string | null;
  reversible: boolean;
  date: string;
  initial: Omit<Row, "key">[];
  accounts: Opt[]; customers: Opt[]; suppliers: Opt[]; warehouses: Opt[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<Row[]>(() => initial.map((r) => ({ ...r, key: ++KEY })));
  const [pending, start] = useTransition();

  const lines: OpeningLine[] = useMemo(() => rows.map((r) => ({
    kind: r.kind,
    accountId: r.kind === "ACCOUNT" ? r.ref : null,
    customerId: r.kind === "CUSTOMER" ? r.ref : null,
    supplierId: r.kind === "SUPPLIER" ? r.ref : null,
    itemId: r.kind === "ITEM" ? r.ref : null,
    warehouseId: r.kind === "ITEM" ? r.warehouseId : null,
    debit: Number(r.debit || 0), credit: Number(r.credit || 0),
    quantity: r.kind === "ITEM" ? Number(r.quantity || 0) : null,
    unitCost: r.kind === "ITEM" ? Number(r.unitCost || 0) : null,
    reference: r.reference || null,
    dueDate: r.dueDate || null,
  })), [rows]);

  const t = useMemo(() => totals(lines), [lines]);
  const problem = useMemo(() => (rows.length ? validateOpening(lines) : "أضف بندًا واحدًا على الأقل"), [lines, rows.length]);
  const equityZero = Math.abs(t.balancing) < 0.005; // the entry always balances (3002 absorbs); this is the "no residual equity" signal

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const del = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const add = (kind: OpeningKind) => setRows((rs) => [...rs, blank(kind)]);
  const byKind = (k: OpeningKind) => rows.filter((r) => r.kind === k);

  const save = (thenPost: boolean) => start(async () => {
    const res = await saveOpeningBalanceAction({ date, lines });
    if (!res.ok || !res.id) { toast.error(res.error ?? "تعذّر الحفظ"); return; }
    if (!thenPost) { toast.success("تم حفظ المسودة"); router.refresh(); return; }
    const p = await postOpeningBalanceAction(res.id);
    if (p.ok) { toast.success("تم ترحيل الأرصدة الافتتاحية"); router.refresh(); }
    else toast.error(p.error ?? "تعذّر الترحيل");
  });

  const reverse = () => start(async () => {
    if (!postedId) return;
    if (!(await confirm({ title: "إلغاء ترحيل الأرصدة الافتتاحية؟", description: "سيُعكس القيد وتُلغى الفواتير الافتتاحية وتُزال حركات المخزون، ثم تعود مسودة للتعديل.", danger: true }))) return;
    const r = await reverseOpeningBalanceAction(postedId);
    if (r.ok) { toast.success("تم إلغاء الترحيل — عادت مسودة"); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الإلغاء");
  });

  // Merge CSV-matched rows (any section) into the draft.
  const mergeCsv = (imported: CsvRow[]) => setRows((rs) => [...rs, ...imported.map((p) => {
    const b = blank(p.kind);
    b.ref = p.refId!; b.refLabel = `${p.code}${p.name ? ` — ${p.name}` : ""}`;
    if (p.kind === "ACCOUNT") { b.debit = p.debit ? String(p.debit) : ""; b.credit = p.credit ? String(p.credit) : ""; }
    else if (p.kind === "CUSTOMER") { b.debit = String(p.amount); b.reference = p.reference; b.dueDate = p.dueDate; }
    else if (p.kind === "SUPPLIER") { b.credit = String(p.amount); b.reference = p.reference; b.dueDate = p.dueDate; }
    else if (p.kind === "ITEM") { b.warehouseId = p.warehouseId!; b.warehouseLabel = p.warehouse; b.quantity = String(p.quantity); b.unitCost = String(p.unitCost); }
    return b;
  })]);

  // ── POSTED view: summary + reverse ──
  if (postedId) {
    return (
      <Card>
        <CardContent className="space-y-3 py-8 text-center">
          <Icon name="CheckCircle2" className="mx-auto size-8 text-emerald-600" />
          <p className="font-medium">الأرصدة الافتتاحية مُرحّلة</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            تُرحَّل مرة واحدة — فهي تصف لحظة واحدة. للتصحيح، ألغِ الترحيل (متاح فقط قبل أي تحصيل/سداد/بيع على الأرصدة) ثم عدّل وأعد الترحيل.
          </p>
          {reversible
            ? <Button variant="outline" disabled={pending} onClick={reverse}><Icon name="Undo2" className="size-4" /> إلغاء الترحيل والتعديل</Button>
            : <p className="text-xs text-amber-600">تمّت معاملات على الأرصدة الافتتاحية — التصحيح الآن بقيد يومية.</p>}
        </CardContent>
      </Card>
    );
  }

  const numCell = "w-32";
  return (
    <div className="space-y-4" dir="rtl">
      <Card>
        <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="ob-date">تاريخ الأرصدة الافتتاحية (بداية السنة المالية) *</Label>
            <Input id="ob-date" type="date" className="w-56" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <div><div className="text-muted-foreground">إجمالي المدين</div><div className="text-lg font-bold tabular-nums">{money(t.debit)}</div></div>
            <div><div className="text-muted-foreground">إجمالي الدائن</div><div className="text-lg font-bold tabular-nums">{money(t.credit)}</div></div>
            <div>
              <div className="text-muted-foreground">حساب الأرصدة الافتتاحية ({OPENING_EQUITY_CODE})</div>
              <div className="text-lg font-bold tabular-nums">{money(Math.abs(t.balancing))} <span className="text-xs font-normal">{t.balancing >= 0 ? "دائن" : "مدين"}</span></div>
            </div>
            <div className={cn("self-center rounded-full px-3 py-1 text-xs font-medium", equityZero ? "bg-emerald-500/15 text-emerald-600" : "bg-amber-500/15 text-amber-600")}>
              {equityZero ? "متوازن (الفرق صفر)" : "الفرق يذهب لحقوق الملكية الافتتاحية"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ACCOUNT" dir="rtl">
        <TabsList>
          <TabsTrigger value="ACCOUNT">الحسابات ({byKind("ACCOUNT").length})</TabsTrigger>
          <TabsTrigger value="CUSTOMER">أرصدة العملاء ({byKind("CUSTOMER").length})</TabsTrigger>
          <TabsTrigger value="SUPPLIER">أرصدة الموردين ({byKind("SUPPLIER").length})</TabsTrigger>
          <TabsTrigger value="ITEM">المخزون الافتتاحي ({byKind("ITEM").length})</TabsTrigger>
        </TabsList>

        {/* ── Accounts ── */}
        <TabsContent value="ACCOUNT">
          <Card><CardContent className="space-y-3 pt-6">
            <CsvImport kind="ACCOUNT" onAdd={mergeCsv} />
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
              <thead className="text-right text-xs text-muted-foreground"><tr>
                <th className="p-2 font-medium">الحساب</th><th className={cn("p-2 font-medium", numCell)}>مدين</th><th className={cn("p-2 font-medium", numCell)}>دائن</th><th className="w-10" />
              </tr></thead>
              <tbody>{byKind("ACCOUNT").map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="p-2"><CellCombobox selectedLabel={r.refLabel} options={accounts} placeholder="اختر الحساب…" onSelect={(id, label) => set(r.key, { ref: id, refLabel: label })} /></td>
                  <td className="p-2"><Input type="number" step="0.01" min="0" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value, credit: "" })} /></td>
                  <td className="p-2"><Input type="number" step="0.01" min="0" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value, debit: "" })} /></td>
                  <td className="p-2"><Button type="button" variant="ghost" size="icon" onClick={() => del(r.key)}><Icon name="Trash2" className="size-4 text-destructive" /></Button></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Button type="button" variant="outline" size="sm" onClick={() => add("ACCOUNT")}><Icon name="Plus" className="size-4" /> إضافة حساب</Button>
          </CardContent></Card>
        </TabsContent>

        {/* ── Customers (individual opening invoices) ── */}
        <TabsContent value="CUSTOMER">
          <Card><CardContent className="space-y-3 pt-6">
            <CsvImport kind="CUSTOMER" onAdd={mergeCsv} />
            <p className="text-xs text-muted-foreground">كل سطر = فاتورة مفتوحة بتاريخ استحقاقها — عشان تحليل الأعمار يطلع صح.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="text-right text-xs text-muted-foreground"><tr>
                <th className="p-2 font-medium">العميل</th><th className="p-2 font-medium w-32">رقم الفاتورة</th><th className="p-2 font-medium w-40">تاريخ الاستحقاق</th><th className={cn("p-2 font-medium", numCell)}>المبلغ (مدين)</th><th className="w-10" />
              </tr></thead>
              <tbody>{byKind("CUSTOMER").map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="p-2"><CellCombobox selectedLabel={r.refLabel} options={customers} placeholder="اختر العميل…" onSelect={(id, label) => set(r.key, { ref: id, refLabel: label })} /></td>
                  <td className="p-2"><Input value={r.reference} placeholder="اختياري" onChange={(e) => set(r.key, { reference: e.target.value })} /></td>
                  <td className="p-2"><Input type="date" value={r.dueDate} onChange={(e) => set(r.key, { dueDate: e.target.value })} /></td>
                  <td className="p-2"><Input type="number" step="0.01" min="0" value={r.debit} onChange={(e) => set(r.key, { debit: e.target.value })} /></td>
                  <td className="p-2"><Button type="button" variant="ghost" size="icon" onClick={() => del(r.key)}><Icon name="Trash2" className="size-4 text-destructive" /></Button></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Button type="button" variant="outline" size="sm" onClick={() => add("CUSTOMER")}><Icon name="Plus" className="size-4" /> فاتورة عميل</Button>
          </CardContent></Card>
        </TabsContent>

        {/* ── Suppliers ── */}
        <TabsContent value="SUPPLIER">
          <Card><CardContent className="space-y-3 pt-6">
            <CsvImport kind="SUPPLIER" onAdd={mergeCsv} />
            <p className="text-xs text-muted-foreground">كل سطر = فاتورة مورّد مفتوحة بتاريخ استحقاقها.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
              <thead className="text-right text-xs text-muted-foreground"><tr>
                <th className="p-2 font-medium">المورّد</th><th className="p-2 font-medium w-32">رقم الفاتورة</th><th className="p-2 font-medium w-40">تاريخ الاستحقاق</th><th className={cn("p-2 font-medium", numCell)}>المبلغ (دائن)</th><th className="w-10" />
              </tr></thead>
              <tbody>{byKind("SUPPLIER").map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="p-2"><CellCombobox selectedLabel={r.refLabel} options={suppliers} placeholder="اختر المورّد…" onSelect={(id, label) => set(r.key, { ref: id, refLabel: label })} /></td>
                  <td className="p-2"><Input value={r.reference} placeholder="اختياري" onChange={(e) => set(r.key, { reference: e.target.value })} /></td>
                  <td className="p-2"><Input type="date" value={r.dueDate} onChange={(e) => set(r.key, { dueDate: e.target.value })} /></td>
                  <td className="p-2"><Input type="number" step="0.01" min="0" value={r.credit} onChange={(e) => set(r.key, { credit: e.target.value })} /></td>
                  <td className="p-2"><Button type="button" variant="ghost" size="icon" onClick={() => del(r.key)}><Icon name="Trash2" className="size-4 text-destructive" /></Button></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Button type="button" variant="outline" size="sm" onClick={() => add("SUPPLIER")}><Icon name="Plus" className="size-4" /> فاتورة مورّد</Button>
          </CardContent></Card>
        </TabsContent>

        {/* ── Opening stock (manual + CSV) ── */}
        <TabsContent value="ITEM">
          <Card><CardContent className="space-y-3 pt-6">
            <CsvImport kind="ITEM" onAdd={mergeCsv} />
            <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
              <thead className="text-right text-xs text-muted-foreground"><tr>
                <th className="p-2 font-medium">الصنف</th><th className="p-2 font-medium w-44">المخزن</th><th className="p-2 font-medium w-24">الكمية</th><th className="p-2 font-medium w-32">تكلفة الوحدة</th><th className="p-2 font-medium w-32">القيمة</th><th className="w-10" />
              </tr></thead>
              <tbody>{byKind("ITEM").map((r) => (
                <tr key={r.key} className="border-t">
                  <td className="p-2"><ItemPicker label={r.refLabel} onPick={(id, label) => set(r.key, { ref: id, refLabel: label })} /></td>
                  <td className="p-2"><CellCombobox selectedLabel={r.warehouseLabel} options={warehouses} placeholder="المخزن…" onSelect={(id, label) => set(r.key, { warehouseId: id, warehouseLabel: label })} /></td>
                  <td className="p-2"><Input type="number" step="1" min="1" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value.replace(/[^\d]/g, "") })} /></td>
                  <td className="p-2"><Input type="number" step="0.01" min="0" value={r.unitCost} onChange={(e) => set(r.key, { unitCost: e.target.value })} /></td>
                  <td className="p-2 tabular-nums text-muted-foreground">{money(Number(r.quantity || 0) * Number(r.unitCost || 0))}</td>
                  <td className="p-2"><Button type="button" variant="ghost" size="icon" onClick={() => del(r.key)}><Icon name="Trash2" className="size-4 text-destructive" /></Button></td>
                </tr>
              ))}</tbody>
            </table></div>
            <Button type="button" variant="outline" size="sm" onClick={() => add("ITEM")}><Icon name="Plus" className="size-4" /> إضافة صنف</Button>
          </CardContent></Card>
        </TabsContent>
      </Tabs>

      <Card><CardContent className="space-y-3 pt-6">
        {problem && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{problem}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending || !!problem} onClick={() => save(false)}>حفظ كمسودة</Button>
          <Button size="sm" disabled={pending || !!problem} onClick={() => save(true)}>حفظ وترحيل</Button>
        </div>
        <p className="text-xs text-muted-foreground">الترحيل ينشئ القيد الافتتاحي + فاتورة لكل رصيد طرف + حركة مخزون لكل صنف. يمكن إلغاء الترحيل قبل أي معاملة على الأرصدة.</p>
      </CardContent></Card>
    </div>
  );
}
