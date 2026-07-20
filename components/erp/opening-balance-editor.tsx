"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { saveOpeningBalanceAction, postOpeningBalanceAction } from "@/app/actions/erp/opening-balance";
import { totals, validateOpening, type OpeningKind, type OpeningLine } from "@/lib/erp/opening-balance";
import { cn, selectCls } from "@/lib/utils";

export type Opt = { id: string; label: string };
type Row = {
  kind: OpeningKind;
  ref: string;          // account / customer / supplier / item id
  refLabel: string;     // CellCombobox shows the label, not the id
  warehouseId: string;
  warehouseLabel: string;
  debit: string; credit: string; quantity: string; unitCost: string;
};

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = (kind: OpeningKind = "ACCOUNT"): Row =>
  ({ kind, ref: "", refLabel: "", warehouseId: "", warehouseLabel: "", debit: "", credit: "", quantity: "", unitCost: "" });

const KINDS: [OpeningKind, string][] = [
  ["ACCOUNT", "حساب"],
  ["CUSTOMER", "عميل"],
  ["SUPPLIER", "مورّد"],
  ["ITEM", "صنف"],
];

/**
 * The migration screen: what the company owed, was owed, held and banked on the day
 * before go-live. Totals and validation run through the same pure functions the
 * server posts with, so what the screen says balances is what actually balances.
 */
export function OpeningBalanceEditor({ posted, date: initialDate, initial, accounts, customers, suppliers, items, warehouses }: {
  posted: boolean;
  date: string;
  initial: Row[];
  accounts: Opt[]; customers: Opt[]; suppliers: Opt[]; items: Opt[]; warehouses: Opt[];
}) {
  const router = useRouter();
  const [date, setDate] = useState(initialDate);
  const [rows, setRows] = useState<Row[]>(initial.length ? initial : [blank()]);
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
  })), [rows]);

  const t = useMemo(() => totals(lines), [lines]);
  const problem = useMemo(() => validateOpening(lines), [lines]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const optsFor = (k: OpeningKind) => (k === "ACCOUNT" ? accounts : k === "CUSTOMER" ? customers : k === "SUPPLIER" ? suppliers : items);

  const save = (thenPost: boolean) => start(async () => {
    const res = await saveOpeningBalanceAction({ date, lines });
    if (!res.ok || !res.id) { toast.error(res.error ?? "تعذّر الحفظ"); return; }
    if (!thenPost) { toast.success("تم حفظ المسودة"); router.refresh(); return; }
    const p = await postOpeningBalanceAction(res.id);
    if (p.ok) { toast.success("تم ترحيل الأرصدة الافتتاحية"); router.refresh(); }
    else toast.error(p.error ?? "تعذّر الترحيل");
  });

  if (posted) {
    return (
      <Card>
        <CardContent className="space-y-2 py-8 text-center">
          <Icon name="CheckCircle2" className="mx-auto size-8 text-emerald-600" />
          <p className="font-medium">الأرصدة الافتتاحية مُرحّلة</p>
          <p className="text-sm text-muted-foreground">
            تُرحَّل مرة واحدة فقط — فهي تصف لحظة واحدة، وترحيلها مرتين يضاعف كل رصيد. لأي تصحيح بعد ذلك استخدم قيد يومية.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle className="text-base">تاريخ الأرصدة</CardTitle></CardHeader>
        <CardContent>
          <div className="max-w-64 space-y-1">
            <Label htmlFor="ob-date">اليوم السابق لبدء التشغيل *</Label>
            <Input id="ob-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">البنود</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-right text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium w-28">النوع</th>
                  <th className="p-2 font-medium">البيان</th>
                  <th className="p-2 font-medium w-40">المخزن / —</th>
                  <th className="p-2 font-medium w-28">كمية</th>
                  <th className="p-2 font-medium w-32">تكلفة الوحدة</th>
                  <th className="p-2 font-medium w-32">مدين</th>
                  <th className="p-2 font-medium w-32">دائن</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isItem = r.kind === "ITEM";
                  const isCust = r.kind === "CUSTOMER";
                  const isSupp = r.kind === "SUPPLIER";
                  return (
                    <tr key={i} className="border-t">
                      <td className="p-2">
                        <select className={selectCls} value={r.kind}
                          onChange={(e) => set(i, { ...blank(e.target.value as OpeningKind) })}>
                          {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="p-2">
                        <CellCombobox selectedLabel={r.refLabel} options={optsFor(r.kind)} placeholder="ابحث…"
                          onSelect={(id, label) => set(i, { ref: id, refLabel: label })} />
                      </td>
                      <td className="p-2">
                        {isItem
                          ? <CellCombobox selectedLabel={r.warehouseLabel} options={warehouses} placeholder="المخزن…"
                              onSelect={(id, label) => set(i, { warehouseId: id, warehouseLabel: label })} />
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="p-2">
                        {isItem ? <Input type="number" step="1" min="0" value={r.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^\d]/g, "") })} /> : null}
                      </td>
                      <td className="p-2">
                        {isItem ? <Input type="number" step="0.01" min="0" value={r.unitCost} onChange={(e) => set(i, { unitCost: e.target.value })} /> : null}
                      </td>
                      <td className="p-2">
                        {isItem ? (
                          <span className="text-xs tabular-nums text-muted-foreground">{money(Number(r.quantity || 0) * Number(r.unitCost || 0))}</span>
                        ) : isSupp ? <span className="text-xs text-muted-foreground">—</span>
                          : <Input type="number" step="0.01" min="0" value={r.debit} onChange={(e) => set(i, { debit: e.target.value, credit: "" })} />}
                      </td>
                      <td className="p-2">
                        {isItem || isCust ? <span className="text-xs text-muted-foreground">—</span>
                          : <Input type="number" step="0.01" min="0" value={r.credit} onChange={(e) => set(i, { credit: e.target.value, debit: "" })} />}
                      </td>
                      <td className="p-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                          disabled={rows.length === 1}>
                          <Icon name="Trash2" className="size-4" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, blank()])}>
            <Icon name="Plus" className="size-4" /> إضافة بند
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div><div className="text-sm text-muted-foreground">إجمالي المدين</div><div className="text-xl font-bold tabular-nums">{money(t.debit)}</div></div>
            <div><div className="text-sm text-muted-foreground">إجمالي الدائن</div><div className="text-xl font-bold tabular-nums">{money(t.credit)}</div></div>
            <div>
              <div className="text-sm text-muted-foreground">حساب الأرصدة الافتتاحية (3002)</div>
              <div className={cn("text-xl font-bold tabular-nums", t.balancing >= 0 ? "text-emerald-600" : "text-amber-600")}>
                {money(Math.abs(t.balancing))} <span className="text-xs font-normal">{t.balancing >= 0 ? "دائن" : "مدين"}</span>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            القيد يتوازن دائمًا: الفرق بين المدين والدائن يذهب لحساب الأرصدة الافتتاحية (حقوق ملكية) — وهو ما يملكه الملّاك فعليًا في هذه اللحظة.
          </p>

          {problem && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{problem}</p>}

          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending || !!problem} onClick={() => save(false)}>حفظ كمسودة</Button>
            <Button size="sm" disabled={pending || !!problem} onClick={() => save(true)}>حفظ وترحيل</Button>
          </div>
          <p className="text-xs text-muted-foreground">الترحيل مرة واحدة فقط لكل مؤسسة ولا يمكن التراجع عنه.</p>
        </CardContent>
      </Card>
    </div>
  );
}
