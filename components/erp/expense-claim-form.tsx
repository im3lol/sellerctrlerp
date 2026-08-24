"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createExpenseClaimAction } from "@/app/actions/erp/expense-claims";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellCombobox } from "@/components/erp/cell-combobox";

type Account = { id: string; code: string; name: string };
type Line = { expenseAccountId: string; amount: number; description: string };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const newLine = (): Line => ({ expenseAccountId: "", amount: 0, description: "" });

export function ExpenseClaimForm({ expenseAccounts, cashAccounts, orgName }: { expenseAccounts: Account[]; cashAccounts: Account[]; orgName: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [employeeName, setEmployeeName] = useState("");
  const [cashAccountId, setCashAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine()]);

  const expOptions = useMemo(() => expenseAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [expenseAccounts]);
  const cashOptions = useMemo(() => cashAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [cashAccounts]);
  const cashLabel = useMemo(() => new Map(cashOptions.map((o) => [o.id, o.label])), [cashOptions]);
  const expLabelById = (id: string) => expOptions.find((o) => o.id === id)?.label ?? "";

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));
  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  const submit = () => {
    if (!employeeName.trim()) return toast.error("أدخل اسم الموظف");
    if (!cashAccountId) return toast.error("اختر حساب التعويض");
    if (lines.some((l) => !l.expenseAccountId || !(l.amount > 0))) return toast.error("أكمل بنود المصروف");
    start(async () => {
      const r = await createExpenseClaimAction({ employeeName, cashAccountId, date, notes, lines });
      if (r.ok) { toast.success("تم حفظ المطالبة (مسودة)"); router.push(r.number ? `/hr/expense-claims/${encodeURIComponent(r.number)}` : "/hr/expense-claims"); router.refresh(); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex w-full items-center justify-between gap-3">
          <CardTitle>بيانات المطالبة</CardTitle>
          <div className="flex gap-2">
            <Button size="sm" onClick={submit} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ المطالبة</Button>
            <Button variant="outline" size="sm" onClick={() => router.push("/hr/expense-claims")}>إلغاء</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="space-y-2"><Label>الشركة</Label><div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{orgName}</div></div>
          <div className="space-y-2"><Label>الموظف</Label><Input value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} placeholder="اسم الموظف" /></div>
          <div className="space-y-2"><Label>التعويض من</Label><CellCombobox selectedLabel={cashLabel.get(cashAccountId) ?? ""} options={cashOptions} onSelect={setCashAccountId} placeholder="نقدية / بنك…" /></div>
          <div className="space-y-2"><Label>التاريخ</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">بند المصروف</TableHead><TableHead className="w-32 text-start">المبلغ</TableHead><TableHead className="text-start">وصف</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><CellCombobox selectedLabel={expLabelById(l.expenseAccountId)} options={expOptions} onSelect={(id) => setLine(i, { expenseAccountId: id })} placeholder="ابحث عن بند…" /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.amount} onChange={(e) => setLine(i, { amount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="اختياري" /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => removeLine(i)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Button variant="outline" onClick={addLine}><Plus className="size-4" />إضافة بند</Button>

        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2 sm:w-1/2"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
          <div className="text-base font-bold text-primary">الإجمالي: {fmt(total)}</div>
        </div>
      </CardContent>
    </Card>
  );
}
