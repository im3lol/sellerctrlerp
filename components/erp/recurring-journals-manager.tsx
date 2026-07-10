"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { upsertRecurringJournalAction, toggleRecurringJournalAction, deleteRecurringJournalAction } from "@/app/actions/erp/recurring-journals";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/erp/recurring-shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CellCombobox } from "@/components/erp/cell-combobox";

type Account = { id: string; code: string; name: string };
type EditLine = { accountId: string; debit: string; credit: string; description: string };
export type RJ = { id: string; name: string; description: string; frequency: string; nextRunDate: string; isActive: boolean; lines: { accountId: string; debit: number; credit: number; description: string }[] };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nl = (): EditLine => ({ accountId: "", debit: "", credit: "", description: "" });

function EditDialog({ rj, accounts, onClose }: { rj: RJ | null; accounts: Account[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState(rj?.name ?? "");
  const [description, setDescription] = useState(rj?.description ?? "");
  const [frequency, setFrequency] = useState<Frequency>((rj?.frequency as Frequency) ?? "MONTHLY");
  const [nextRunDate, setNextRunDate] = useState(rj?.nextRunDate || today);
  const [lines, setLines] = useState<EditLine[]>(rj ? rj.lines.map((l) => ({ accountId: l.accountId, debit: l.debit ? String(l.debit) : "", credit: l.credit ? String(l.credit) : "", description: l.description })) : [nl(), nl()]);

  const opts = useMemo(() => accounts.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` })), [accounts]);
  const label = (id: string) => opts.find((o) => o.id === id)?.label ?? "";
  const setLine = (i: number, patch: Partial<EditLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totDr = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totCr = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = totDr > 0 && Math.abs(totDr - totCr) < 0.01;

  const save = () => start(async () => {
    const r = await upsertRecurringJournalAction({ id: rj?.id, name, description, frequency, nextRunDate, lines: lines.map((l) => ({ accountId: l.accountId, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, description: l.description })) });
    if (r.ok) { toast.success("تم حفظ القالب"); onClose(); router.refresh(); }
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  return (
    <DialogContent dir="rtl" className="max-w-2xl">
      <DialogHeader><DialogTitle>{rj ? "تعديل قيد متكرر" : "قيد متكرر جديد"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>اسم القالب</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="استحقاق الإيجار الشهري" /></div>
          <div className="space-y-1.5"><Label>الوصف (بيان القيد)</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="اختياري" /></div>
          <div className="space-y-1.5">
            <Label>التكرار</Label>
            <select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>أول تنفيذ</Label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">الحساب</TableHead><TableHead className="w-28 text-start">مدين</TableHead><TableHead className="w-28 text-start">دائن</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><CellCombobox selectedLabel={label(l.accountId)} options={opts} onSelect={(id) => setLine(i, { accountId: id })} placeholder="ابحث عن الحساب…" /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls))} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, nl()])}><Plus className="size-4" />إضافة بند</Button>
          <span className={`text-sm font-medium ${balanced ? "text-emerald-600" : "text-destructive"}`}>مدين {fmt(totDr)} · دائن {fmt(totCr)} {balanced ? "· متوازن ✓" : "· غير متوازن"}</span>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending || !balanced || !name.trim()}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function RecurringJournalsManager({ items, accounts }: { items: RJ[]; accounts: Account[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; rj: RJ | null }>({ open: false, rj: null });
  const [confirmDel, setConfirmDel] = useState<RJ | null>(null);

  const toggle = (id: string) => start(async () => { const r = await toggleRecurringJournalAction(id); if (r.ok) router.refresh(); else toast.error(r.error ?? ""); });
  const del = (rj: RJ) => start(async () => { const r = await deleteRecurringJournalAction(rj.id); if (r.ok) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{items.length} قالب — يولّد قيداً كمسودة تلقائياً في موعده</span>
          <Button size="sm" onClick={() => setDialog({ open: true, rj: null })}><Plus className="size-4" />قالب جديد</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">الاسم</TableHead><TableHead className="text-start">التكرار</TableHead>
            <TableHead className="text-start">التنفيذ القادم</TableHead><TableHead className="text-start">البنود</TableHead>
            <TableHead className="text-start">الحالة</TableHead><TableHead className="text-start">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">لا توجد قوالب — أنشئ أول قالب.</TableCell></TableRow>
            ) : items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{FREQUENCY_LABELS[r.frequency as Frequency] ?? r.frequency}</TableCell>
                <TableCell className="tabular-nums">{r.nextRunDate}</TableCell>
                <TableCell className="tabular-nums">{r.lines.length}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "مفعّل" : "موقوف"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, rj: r })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(r.id)}>{r.isActive ? "إيقاف" : "تفعيل"}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(r)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, rj: null })}>
        {dialog.open && <EditDialog rj={dialog.rj} accounts={accounts} onClose={() => setDialog({ open: false, rj: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف القالب «{confirmDel.name}»؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">القيود التي وُلّدت بالفعل لا تتأثر.</p>
            <DialogFooter><Button variant="outline" onClick={() => setConfirmDel(null)}>إلغاء</Button><Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>حذف</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
