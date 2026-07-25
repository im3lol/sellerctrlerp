"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setLinesReconciledAction } from "@/app/actions/erp/reconciliation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { selectCls } from "@/lib/utils";

type Acc = { id: string; label: string };
type Line = { id: string; date: string; number: string; description: string; debit: number; credit: number; reconciled: boolean };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReconciliationClient({ accounts, selectedAccountId, lines }: { accounts: Acc[]; selectedAccountId: string; lines: Line[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checks, setChecks] = useState<Record<string, boolean>>(() => Object.fromEntries(lines.map((l) => [l.id, l.reconciled])));
  const [statement, setStatement] = useState("");

  const bookBalance = useMemo(() => lines.reduce((s, l) => s + l.debit - l.credit, 0), [lines]);
  const cleared = useMemo(() => lines.reduce((s, l) => s + (checks[l.id] ? l.debit - l.credit : 0), 0), [lines, checks]);
  const stmt = Number(statement) || 0;
  const diff = stmt - cleared;
  const dirty = lines.some((l) => !!checks[l.id] !== l.reconciled);

  const onAccount = (id: string) => router.push(`/accounting/reconciliation${id ? `?account=${id}` : ""}`);

  const save = () => start(async () => {
    const toRec = lines.filter((l) => checks[l.id] && !l.reconciled).map((l) => l.id);
    const toUn = lines.filter((l) => !checks[l.id] && l.reconciled).map((l) => l.id);
    const r = await setLinesReconciledAction(toRec, toUn);
    if (r.ok) { toast.success("تم حفظ المطابقة"); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  return (
    <div className="space-y-4">
      <Card><CardContent className="grid gap-4 pt-6 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>الحساب البنكي / النقدي</Label>
          <select className={selectCls} value={selectedAccountId} onChange={(e) => onAccount(e.target.value)}>
            <option value="">— اختر —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>رصيد كشف البنك</Label>
          <Input type="number" step="0.01" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="أدخل الرصيد الختامي" />
        </div>
        <div className="flex items-end">
          <Button onClick={save} disabled={!dirty || pending} className="w-full">{pending && <Loader2 className="size-4 animate-spin" />}حفظ المطابقة</Button>
        </div>
      </CardContent></Card>

      {selectedAccountId && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">رصيد الدفاتر</div><div className="text-xl font-bold tabular-nums">{fmt(bookBalance)}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">الرصيد المطابَق (المحدّد)</div><div className="text-xl font-bold tabular-nums">{fmt(cleared)}</div></CardContent></Card>
          <Card className={statement && Math.abs(diff) < 0.01 ? "border-emerald-500/50" : statement ? "border-destructive/50" : ""}>
            <CardContent className="pt-6"><div className="text-sm text-muted-foreground">الفرق عن الكشف</div><div className={`text-xl font-bold tabular-nums ${statement ? (Math.abs(diff) < 0.01 ? "text-emerald-600" : "text-destructive") : ""}`}>{statement ? (Math.abs(diff) < 0.01 ? "مطابَق ✓" : fmt(diff)) : "—"}</div></CardContent></Card>
        </div>
      )}

      {selectedAccountId && (
        <Card><CardContent className="p-0">
          {lines.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد حركات على هذا الحساب.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-10 text-start">مطابَق</TableHead>
                <TableHead className="text-start">التاريخ</TableHead>
                <TableHead className="text-start">القيد</TableHead>
                <TableHead className="text-start">البيان</TableHead>
                <TableHead className="text-end">مدين</TableHead>
                <TableHead className="text-end">دائن</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {lines.map((l) => (
                  <TableRow key={l.id} className={checks[l.id] ? "bg-emerald-500/5" : ""}>
                    <TableCell><input type="checkbox" className="size-4" checked={!!checks[l.id]} onChange={(e) => setChecks((c) => ({ ...c, [l.id]: e.target.checked }))} /></TableCell>
                    <TableCell className="text-sm">{l.date}</TableCell>
                    <TableCell className="font-mono text-xs">{l.number}</TableCell>
                    <TableCell className="max-w-[280px] truncate text-sm" title={l.description || undefined}>{l.description || "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">{l.debit ? fmt(l.debit) : "—"}</TableCell>
                    <TableCell className="text-end tabular-nums">{l.credit ? fmt(l.credit) : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}
