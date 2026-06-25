"use client";

import { useTransition, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { addStatementLineAction, toggleStatementLineReconciledAction, deleteStatementLineAction } from "@/app/actions/erp/bank-accounts";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

type StmtLine = {
  id: string;
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  isReconciled: boolean;
};

type GlLine = {
  id: string;
  date: string;
  number: string;
  description: string;
  debit: number;
  credit: number;
};

type Props = {
  bankAccountId: string;
  lines: StmtLine[];
  glLines: GlLine[];
  canEdit: boolean;
};

export function BankStatementClient({ bankAccountId, lines, glLines, canEdit }: Props) {
  const [pending, start] = useTransition();
  const [showAdd, setShowAdd] = useState(false);
  const [showGl, setShowGl] = useState(false);
  const [form, setForm] = useState({ date: today(), description: "", reference: "", debit: "", credit: "" });

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      await addStatementLineAction({
        bankAccountId,
        date: form.date,
        description: form.description,
        reference: form.reference,
        debit: form.debit ? Number(form.debit) : 0,
        credit: form.credit ? Number(form.credit) : 0,
      });
      setForm({ date: today(), description: "", reference: "", debit: "", credit: "" });
      setShowAdd(false);
    });
  }

  function toggleReconcile(lineId: string) {
    start(async () => { await toggleStatementLineReconciledAction(lineId); });
  }

  function deleteLine(lineId: string) {
    if (!confirm("حذف هذا السطر؟")) return;
    start(async () => { await deleteStatementLineAction(lineId); });
  }

  // Running balance
  let run = 0;
  const withBalance = lines.map((l) => {
    run += l.debit - l.credit;
    return { ...l, balance: run };
  });

  return (
    <div className="space-y-4">
      {/* Statement lines */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">كشف الحساب البنكي</CardTitle>
          {canEdit && (
            <Button size="sm" onClick={() => setShowAdd(!showAdd)} disabled={pending}>
              <Icon name="Plus" className="size-4" />
              إضافة سطر
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {canEdit && showAdd && (
            <form onSubmit={handleAdd} className="rounded-xl border p-4 space-y-3 bg-muted/30">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="space-y-1">
                  <Label className="text-xs">التاريخ *</Label>
                  <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs">البيان</Label>
                  <Input placeholder="وصف الحركة" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">المرجع</Label>
                  <Input placeholder="رقم الشيك…" value={form.reference} onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:col-span-1 col-span-2">
                  <div className="space-y-1">
                    <Label className="text-xs">وارد (+)</Label>
                    <Input type="number" step="0.01" min="0" placeholder="0.00" value={form.debit} onChange={(e) => setForm((f) => ({ ...f, debit: e.target.value, credit: "" }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">صادر (−)</Label>
                    <Input type="number" step="0.01" min="0" placeholder="0.00" value={form.credit} onChange={(e) => setForm((f) => ({ ...f, credit: e.target.value, debit: "" }))} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={pending}>حفظ</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowAdd(false)}>إلغاء</Button>
              </div>
            </form>
          )}

          {withBalance.length === 0 ? (
            <div className="rounded-xl border border-dashed py-10 text-center text-sm text-muted-foreground">
              لا توجد سطور في الكشف. أضف سطرًا أو استورد الكشف من البنك.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr className="[&>th]:p-2.5 [&>th]:text-start">
                    <th>التاريخ</th>
                    <th>البيان</th>
                    <th>المرجع</th>
                    <th className="text-end">وارد</th>
                    <th className="text-end">صادر</th>
                    <th className="text-end">الرصيد</th>
                    <th className="text-center">مسوّى</th>
                    {canEdit && <th />}
                  </tr>
                </thead>
                <tbody>
                  {withBalance.map((l) => (
                    <tr
                      key={l.id}
                      className={`border-t [&>td]:p-2.5 transition-colors ${l.isReconciled ? "bg-emerald-50/30 dark:bg-emerald-950/20" : ""}`}
                    >
                      <td className="text-xs text-muted-foreground whitespace-nowrap">{l.date}</td>
                      <td className="max-w-40 truncate">{l.description || "—"}</td>
                      <td className="font-mono text-xs text-muted-foreground">{l.reference || "—"}</td>
                      <td className="text-end tabular-nums text-emerald-700 dark:text-emerald-400">
                        {l.debit > 0 ? fmt(l.debit) : "—"}
                      </td>
                      <td className="text-end tabular-nums text-red-700 dark:text-red-400">
                        {l.credit > 0 ? fmt(l.credit) : "—"}
                      </td>
                      <td className={`text-end tabular-nums font-medium ${l.balance < 0 ? "text-red-600 dark:text-red-400" : ""}`}>
                        {fmt(l.balance)}
                      </td>
                      <td className="text-center">
                        {canEdit ? (
                          <button
                            onClick={() => toggleReconcile(l.id)}
                            disabled={pending}
                            className="rounded p-1 hover:bg-muted transition-colors"
                            title={l.isReconciled ? "إلغاء التسوية" : "تسوية"}
                          >
                            <Icon
                              name={l.isReconciled ? "CheckCircle2" : "Circle"}
                              className={`size-4 ${l.isReconciled ? "text-emerald-600" : "text-muted-foreground"}`}
                            />
                          </button>
                        ) : (
                          <Icon name={l.isReconciled ? "CheckCircle2" : "Circle"} className={`size-4 mx-auto ${l.isReconciled ? "text-emerald-600" : "text-muted-foreground"}`} />
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          <button
                            onClick={() => deleteLine(l.id)}
                            disabled={pending}
                            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          >
                            <Icon name="Trash2" className="size-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* GL reference */}
      {glLines.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">حركات الأستاذ (للمقارنة)</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowGl(!showGl)}>
              <Icon name={showGl ? "ChevronUp" : "ChevronDown"} className="size-4" />
              {showGl ? "إخفاء" : "عرض"}
            </Button>
          </CardHeader>
          {showGl && (
            <CardContent>
              <div className="overflow-hidden rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr className="[&>th]:p-2.5 [&>th]:text-start">
                      <th>التاريخ</th>
                      <th>القيد</th>
                      <th>البيان</th>
                      <th className="text-end">مدين</th>
                      <th className="text-end">دائن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {glLines.map((l) => (
                      <tr key={l.id} className="border-t [&>td]:p-2.5">
                        <td className="text-xs text-muted-foreground">{l.date}</td>
                        <td className="font-mono text-xs">{l.number}</td>
                        <td className="max-w-48 truncate">{l.description || "—"}</td>
                        <td className="text-end tabular-nums">{l.debit > 0 ? fmt(l.debit) : "—"}</td>
                        <td className="text-end tabular-nums">{l.credit > 0 ? fmt(l.credit) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
