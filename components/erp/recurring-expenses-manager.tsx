"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { upsertRecurringExpenseAction, toggleRecurringExpenseAction, deleteRecurringExpenseAction, bulkDeleteRecurringExpensesAction } from "@/app/actions/erp/recurring-expenses";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/erp/recurring-shared";
import { useSelection, BulkDeleteBar, SelectBox } from "@/components/erp/bulk-select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CellCombobox } from "@/components/erp/cell-combobox";
import { selectCls } from "@/lib/utils";

type Account = { id: string; code: string; name: string };
export type Recurring = {
  id: string; expenseAccountId: string; cashAccountId: string; amount: number; frequency: string;
  nextRunDate: string; paymentMethod: string; payee: string; notes: string; isActive: boolean;
  category: string; paidFrom: string;
};

const egp = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function EditDialog({ rec, expenseAccounts, cashAccounts, onClose }: { rec: Recurring | null; expenseAccounts: Account[]; cashAccounts: Account[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);

  const [expenseAccountId, setExpenseAccountId] = useState(rec?.expenseAccountId ?? "");
  const [cashAccountId, setCashAccountId] = useState(rec?.cashAccountId ?? cashAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState(rec ? String(rec.amount) : "");
  const [frequency, setFrequency] = useState<Frequency>((rec?.frequency as Frequency) ?? "MONTHLY");
  const [nextRunDate, setNextRunDate] = useState(rec?.nextRunDate || today);
  const [payee, setPayee] = useState(rec?.payee ?? "");
  const [notes, setNotes] = useState(rec?.notes ?? "");

  const expOptions = useMemo(() => expenseAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [expenseAccounts]);
  const expLabel = useMemo(() => new Map(expOptions.map((o) => [o.id, o.label])), [expOptions]);
  const cashOptions = useMemo(() => cashAccounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [cashAccounts]);
  const cashLabel = useMemo(() => new Map(cashOptions.map((o) => [o.id, o.label])), [cashOptions]);

  const save = () => start(async () => {
    const r = await upsertRecurringExpenseAction({ id: rec?.id, expenseAccountId, cashAccountId, amount: Number(amount) || 0, frequency, nextRunDate, payee, notes });
    if (r.ok) { toast.success("تم حفظ القالب المتكرر"); onClose(); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader><DialogTitle>{rec ? "تعديل مصروف متكرر" : "مصروف متكرر جديد"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>بند المصروف</Label>
          <CellCombobox selectedLabel={expLabel.get(expenseAccountId) ?? ""} options={expOptions} onSelect={setExpenseAccountId} placeholder="ابحث عن بند المصروف…" />
        </div>
        <div className="space-y-1.5">
          <Label>الدفع من (نقدية / بنك)</Label>
          <CellCombobox selectedLabel={cashLabel.get(cashAccountId) ?? ""} options={cashOptions} onSelect={setCashAccountId} placeholder="ابحث عن الحساب…" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>المبلغ</Label><Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>التكرار</Label>
            <select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>أول تنفيذ</Label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>المستفيد (اختياري)</Label><Input value={payee} onChange={(e) => setPayee(e.target.value)} /></div>
        </div>
        <div className="space-y-1.5"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function RecurringExpensesManager({ items, expenseAccounts, cashAccounts }: { items: Recurring[]; expenseAccounts: Account[]; cashAccounts: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; rec: Recurring | null }>({ open: false, rec: null });
  const [confirmDel, setConfirmDel] = useState<Recurring | null>(null);
  const sel = useSelection();
  const allIds = items.map((r) => r.id);

  const toggle = (id: string) => start(async () => { const r = await toggleRecurringExpenseAction(id); if (r.ok) router.refresh(); else toast.error(r.error ?? ""); });
  const del = (rec: Recurring) => start(async () => { const r = await deleteRecurringExpenseAction(rec.id); if (r.ok) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{items.length} قالب — تُولَّد كمسودة تلقائياً عند حلول موعدها</span>
          <Button size="sm" onClick={() => setDialog({ open: true, rec: null })}><Plus className="size-4" />قالب جديد</Button>
        </div>
        <>
        <BulkDeleteBar ids={sel.ids} action={bulkDeleteRecurringExpensesAction} onDone={sel.clear} entity="قالب" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><SelectBox label="تحديد الكل" checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>
              <TableHead className="text-start">البند</TableHead>
              <TableHead className="text-start">المبلغ</TableHead>
              <TableHead className="text-start">التكرار</TableHead>
              <TableHead className="text-start">التنفيذ القادم</TableHead>
              <TableHead className="text-start">الدفع من</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">لا توجد قوالب متكررة — أنشئ أول قالب.</TableCell></TableRow>
            ) : items.map((r) => (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                <TableCell><SelectBox label="تحديد" checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.category}{r.payee ? <span className="text-xs text-muted-foreground"> — {r.payee}</span> : ""}</TableCell>
                <TableCell className="tabular-nums">{egp(r.amount)}</TableCell>
                <TableCell>{FREQUENCY_LABELS[r.frequency as Frequency] ?? r.frequency}</TableCell>
                <TableCell className="tabular-nums">{r.nextRunDate}</TableCell>
                <TableCell>{r.paidFrom}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "مفعّل" : "موقوف"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, rec: r })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(r.id)}>{r.isActive ? "إيقاف" : "تفعيل"}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(r)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, rec: null })}>
        {dialog.open && <EditDialog rec={dialog.rec} expenseAccounts={expenseAccounts} cashAccounts={cashAccounts} onClose={() => setDialog({ open: false, rec: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف القالب المتكرر؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">لن يؤثر على المصروفات التي وُلّدت بالفعل.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>إلغاء</Button>
              <Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>حذف</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
