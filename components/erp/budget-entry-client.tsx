"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { saveBudgetAction } from "@/app/actions/erp/budget";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import Link from "next/link";

interface Row { id: string; code: string; nameAr: string; type: string; budget: number }

const fmt = (v: number) => v.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function BudgetEntryClient({
  year,
  rows,
  canEdit,
}: { year: number; rows: Row[]; canEdit: boolean }) {
  const [budgets, setBudgets] = useState<Record<string, string>>(
    () => Object.fromEntries(rows.map((r) => [r.id, r.budget > 0 ? String(r.budget) : ""])),
  );
  const [pending, start] = useTransition();

  const revenues = rows.filter((r) => r.type === "REVENUE");
  const expenses = rows.filter((r) => r.type === "EXPENSE");

  const totalRevBudget = revenues.reduce((s, r) => s + Number(budgets[r.id] || 0), 0);
  const totalExpBudget = expenses.reduce((s, r) => s + Number(budgets[r.id] || 0), 0);

  function handleSave() {
    const lines = rows
      .map((r) => ({ accountId: r.id, amount: Number(budgets[r.id]) || 0 }))
      .filter((l) => l.amount >= 0);

    start(async () => {
      const res = await saveBudgetAction({ year, lines });
      if (res.ok) {
        toast.success("تم حفظ الميزانية");
      } else {
        toast.error(res.error ?? "تعذّر الحفظ");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">ميزانية الإيرادات</p>
          <p className="text-xl font-bold tabular-nums text-success">{fmt(totalRevBudget)}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">ميزانية المصروفات</p>
          <p className="text-xl font-bold tabular-nums text-destructive">{fmt(totalExpBudget)}</p>
        </div>
        <div className="rounded-xl border bg-muted/30 p-4 text-center">
          <p className="text-xs text-muted-foreground">صافي الميزانية</p>
          <p className={`text-xl font-bold tabular-nums ${totalRevBudget - totalExpBudget >= 0 ? "text-success" : "text-destructive"}`}>
            {fmt(totalRevBudget - totalExpBudget)}
          </p>
        </div>
      </div>

      {/* Revenue accounts */}
      {revenues.length > 0 && (
        <AccountSection
          title="الإيرادات"
          rows={revenues}
          budgets={budgets}
          canEdit={canEdit}
          onChange={(id, v) => setBudgets((p) => ({ ...p, [id]: v }))}
          total={totalRevBudget}
          color="text-success"
        />
      )}

      {/* Expense accounts */}
      {expenses.length > 0 && (
        <AccountSection
          title="المصروفات"
          rows={expenses}
          budgets={budgets}
          canEdit={canEdit}
          onChange={(id, v) => setBudgets((p) => ({ ...p, [id]: v }))}
          total={totalExpBudget}
          color="text-destructive"
        />
      )}

      {canEdit && (
        <div className="flex gap-3">
          <Button onClick={handleSave} disabled={pending}>
            {pending ? <Icon name="Loader2" className="size-4 animate-spin" /> : <Icon name="Save" className="size-4" />}
            حفظ الميزانية
          </Button>
          <Button variant="outline" asChild>
            <Link href={`/erp/accounting/budget/${year}/report`}>
              <Icon name="BarChart2" className="size-4" />عرض التقرير
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function AccountSection({
  title, rows, budgets, canEdit, onChange, total, color,
}: {
  title: string;
  rows: Row[];
  budgets: Record<string, string>;
  canEdit: boolean;
  onChange: (id: string, v: string) => void;
  total: number;
  color: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{title}</span>
          <span className={`tabular-nums ${color}`}>{(total).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-start">الحساب</th>
              <th className="px-4 py-2 text-start w-24">الكود</th>
              <th className="px-4 py-2 text-end w-44">الميزانية</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-muted/20">
                <td className="px-4 py-2">{r.nameAr}</td>
                <td className="px-4 py-2 font-mono text-muted-foreground">{r.code}</td>
                <td className="px-4 py-2 text-end">
                  {canEdit ? (
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={budgets[r.id] ?? ""}
                      onChange={(e) => onChange(r.id, e.target.value)}
                      placeholder="0.00"
                      className="h-8 w-36 rounded-md border border-input bg-transparent px-3 text-end text-sm tabular-nums shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  ) : (
                    <span className="tabular-nums">{Number(budgets[r.id] || 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2 })}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
