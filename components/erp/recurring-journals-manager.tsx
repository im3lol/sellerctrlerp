"use client";

import { useMemo, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { upsertRecurringJournalAction, toggleRecurringJournalAction, deleteRecurringJournalAction, bulkDeleteRecurringJournalsAction } from "@/app/actions/erp/recurring-journals";
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
type EditLine = { accountId: string; debit: string; credit: string; description: string };
export type RJ = { id: string; name: string; description: string; frequency: string; nextRunDate: string; isActive: boolean; lines: { accountId: string; debit: number; credit: number; description: string }[] };

const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nl = (): EditLine => ({ accountId: "", debit: "", credit: "", description: "" });

function EditDialog({ rj, accounts, onClose }: { rj: RJ | null; accounts: Account[]; onClose: () => void }) {
  const t = useT();
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
    else toast.error(r.error ?? t("تعذّر الحفظ"));
  });

  return (
    <DialogContent dir="rtl" className="max-w-2xl">
      <DialogHeader><DialogTitle>{rj ? t("تعديل قيد متكرر") : t("قيد متكرر جديد")}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{t("اسم القالب")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("استحقاق الإيجار الشهري")} /></div>
          <div className="space-y-1.5"><Label>{t("الوصف (بيان القيد)")}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("اختياري")} /></div>
          <div className="space-y-1.5">
            <Label>{t("التكرار")}</Label>
            <select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>{t("أول تنفيذ")}</Label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
        </div>

        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">{t("الحساب")}</TableHead><TableHead className="w-28 text-start">{t("مدين")}</TableHead><TableHead className="w-28 text-start">{t("دائن")}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><CellCombobox selectedLabel={label(l.accountId)} options={opts} onSelect={(id) => setLine(i, { accountId: id })} placeholder={t("ابحث عن الحساب…")} /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" min="0" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 2 ? ls.filter((_, idx) => idx !== i) : ls))} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, nl()])}><Plus className="size-4" />{t("إضافة بند")}</Button>
          <span className={`text-sm font-medium ${balanced ? "text-emerald-600" : "text-destructive"}`}>مدين {fmt(totDr)} · دائن {fmt(totCr)} {balanced ? t("· متوازن ✓") : t("· غير متوازن")}</span>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("إلغاء")}</Button>
        <Button onClick={save} disabled={pending || !balanced || !name.trim()}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function RecurringJournalsManager({ items, accounts }: { items: RJ[]; accounts: Account[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; rj: RJ | null }>({ open: false, rj: null });
  const [confirmDel, setConfirmDel] = useState<RJ | null>(null);
  const sel = useSelection();
  const allIds = items.map((r) => r.id);

  const toggle = (id: string) => start(async () => { const r = await toggleRecurringJournalAction(id); if (r.ok) router.refresh(); else toast.error(r.error ?? ""); });
  const del = (rj: RJ) => start(async () => { const r = await deleteRecurringJournalAction(rj.id); if (r.ok) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{items.length} قالب — يولّد قيداً كمسودة تلقائياً في موعده</span>
          <Button size="sm" onClick={() => setDialog({ open: true, rj: null })}><Plus className="size-4" />{t("قالب جديد")}</Button>
        </div>
        <>
        <BulkDeleteBar ids={sel.ids} action={bulkDeleteRecurringJournalsAction} onDone={sel.clear} entity="قالب" />
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10"><SelectBox label={t("تحديد الكل")} checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>
            <TableHead className="text-start">{t("الاسم")}</TableHead><TableHead className="text-start">{t("التكرار")}</TableHead>
            <TableHead className="text-start">{t("التنفيذ القادم")}</TableHead><TableHead className="text-start">{t("البنود")}</TableHead>
            <TableHead className="text-start">{t("الحالة")}</TableHead><TableHead className="text-start">{t("إجراءات")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("لا توجد قوالب — أنشئ أول قالب.")}</TableCell></TableRow>
            ) : items.map((r) => (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                <TableCell><SelectBox label={t("تحديد")} checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{t(FREQUENCY_LABELS[r.frequency as Frequency] ?? r.frequency)}</TableCell>
                <TableCell className="tabular-nums">{r.nextRunDate}</TableCell>
                <TableCell className="tabular-nums">{r.lines.length}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? t("مفعّل") : t("موقوف")}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, rj: r })} aria-label={t("تعديل")}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(r.id)}>{r.isActive ? t("إيقاف") : t("تفعيل")}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(r)} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, rj: null })}>
        {dialog.open && <EditDialog rj={dialog.rj} accounts={accounts} onClose={() => setDialog({ open: false, rj: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف القالب «{confirmDel.name}»؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{t("القيود التي وُلّدت بالفعل لا تتأثر.")}</p>
            <DialogFooter><Button variant="outline" onClick={() => setConfirmDel(null)}>{t("إلغاء")}</Button><Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>{t("حذف")}</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
