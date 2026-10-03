"use client";

import { useMemo, useState, useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { upsertRecurringSalesInvoiceAction, toggleRecurringSalesInvoiceAction, deleteRecurringSalesInvoiceAction, bulkDeleteRecurringSalesInvoicesAction } from "@/app/actions/erp/recurring-sales-invoices";
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
import { ItemPicker } from "@/components/erp/item-picker";
import type { ItemSearchResult } from "@/app/actions/erp/item-search";
import { selectCls } from "@/lib/utils";

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null };
type Line = { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number };
export type RSI = { id: string; customerId: string; customer: string; frequency: string; nextRunDate: string; isActive: boolean; notes: string; total: number; lines: Line[] };

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nl = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, discountAmount: 0, taxAmount: 0 });

function EditDialog({ rsi, customers, items, onClose }: { rsi: RSI | null; customers: Customer[]; items: Item[]; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const [customerId, setCustomerId] = useState(rsi?.customerId ?? "");
  const [frequency, setFrequency] = useState<Frequency>((rsi?.frequency as Frequency) ?? "MONTHLY");
  const [nextRunDate, setNextRunDate] = useState(rsi?.nextRunDate || today);
  const [notes, setNotes] = useState(rsi?.notes ?? "");
  const [lines, setLines] = useState<Line[]>(rsi && rsi.lines.length ? rsi.lines : [nl()]);

  const custOptions = useMemo(() => customers.map((c) => ({ id: c.id, label: c.nameAr })), [customers]);
  const custLabel = useMemo(() => new Map(custOptions.map((o) => [o.id, o.label])), [custOptions]);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const pickItem = (i: number, it: ItemSearchResult) => setLine(i, { itemId: it.id, unitPrice: Number(it.sellPrice) || 0 });
  const total = round2(lines.reduce((s, l) => s + l.quantity * l.unitPrice - l.discountAmount + l.taxAmount, 0));

  const save = () => start(async () => {
    if (!customerId) { toast.error("اختر العميل"); return; }
    if (lines.some((l) => !l.itemId)) { toast.error("اختر الصنف في كل بند"); return; }
    const r = await upsertRecurringSalesInvoiceAction({ id: rsi?.id, customerId, frequency, nextRunDate, notes, lines });
    if (r.ok) { toast.success("تم حفظ القالب"); onClose(); router.refresh(); }
    else toast.error(r.error ?? t("تعذّر الحفظ"));
  });

  return (
    <DialogContent dir="rtl" className="max-w-2xl">
      <DialogHeader><DialogTitle>{rsi ? t("تعديل فاتورة دورية") : t("فاتورة دورية جديدة")}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>{t("العميل")}</Label><CellCombobox selectedLabel={custLabel.get(customerId) ?? ""} options={custOptions} onSelect={setCustomerId} placeholder={t("ابحث…")} /></div>
          <div className="space-y-1.5"><Label>{t("التكرار")}</Label><select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>{Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select></div>
          <div className="space-y-1.5"><Label>{t("أول تنفيذ")}</Label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
        </div>
        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">{t("الصنف")}</TableHead><TableHead className="w-20 text-start">{t("كمية")}</TableHead><TableHead className="w-24 text-start">{t("سعر")}</TableHead><TableHead className="w-20 text-start">{t("خصم")}</TableHead><TableHead className="w-20 text-start">{t("ضريبة")}</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => pickItem(i, it)} /></TableCell>
                  <TableCell><Input type="number" step="1" min="1" value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.taxAmount} onChange={(e) => setLine(i, { taxAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, nl()])}><Plus className="size-4" />{t("إضافة بند")}</Button>
          <span className="text-sm">{t("الإجمالي:")} <b>{fmt(total)}</b></span>
        </div>
        <div className="space-y-1.5"><Label>{t("ملاحظات")}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("اختياري")} /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>{t("إلغاء")}</Button><Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button></DialogFooter>
    </DialogContent>
  );
}

export function RecurringSalesInvoicesManager({ items: templates, customers, itemsList }: { items: RSI[]; customers: Customer[]; itemsList: Item[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; rsi: RSI | null }>({ open: false, rsi: null });
  const [confirmDel, setConfirmDel] = useState<RSI | null>(null);
  const sel = useSelection();
  const allIds = templates.map((r) => r.id);

  const toggle = (id: string) => start(async () => { const r = await toggleRecurringSalesInvoiceAction(id); if (r.ok) router.refresh(); else toast.error(r.error ?? ""); });
  const del = (rsi: RSI) => start(async () => { const r = await deleteRecurringSalesInvoiceAction(rsi.id); if (r.ok) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{templates.length} قالب — يولّد فاتورة بيع كمسودة تلقائياً في موعده</span>
          <Button size="sm" onClick={() => setDialog({ open: true, rsi: null })}><Plus className="size-4" />{t("قالب جديد")}</Button>
        </div>
        <>
        <BulkDeleteBar ids={sel.ids} action={bulkDeleteRecurringSalesInvoicesAction} onDone={sel.clear} entity="قالب" />
        <Table>
          <TableHeader><TableRow>
            <TableHead className="w-10"><SelectBox label={t("تحديد الكل")} checked={sel.allOf(allIds)} indeterminate={sel.someOf(allIds)} onChange={() => sel.togglePage(allIds)} /></TableHead>
            <TableHead className="text-start">{t("العميل")}</TableHead><TableHead className="text-start">{t("التكرار")}</TableHead>
            <TableHead className="text-start">{t("التنفيذ القادم")}</TableHead><TableHead className="text-end">{t("الإجمالي")}</TableHead>
            <TableHead className="text-start">{t("الحالة")}</TableHead><TableHead className="text-start">{t("إجراءات")}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">{t("لا توجد قوالب — أنشئ أول قالب.")}</TableCell></TableRow>
            ) : templates.map((r) => (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                <TableCell><SelectBox label={t("تحديد")} checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} /></TableCell>
                <TableCell className="font-medium">{r.customer}</TableCell>
                <TableCell>{t(FREQUENCY_LABELS[r.frequency as Frequency] ?? r.frequency)}</TableCell>
                <TableCell className="tabular-nums">{r.nextRunDate}</TableCell>
                <TableCell className="text-end tabular-nums">{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? t("مفعّل") : t("موقوف")}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, rsi: r })} aria-label={t("تعديل")}><Pencil className="size-4" /></Button>
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

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, rsi: null })}>
        {dialog.open && <EditDialog rsi={dialog.rsi} customers={customers} items={itemsList} onClose={() => setDialog({ open: false, rsi: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>{t("حذف القالب؟")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{t("الفواتير التي وُلّدت بالفعل لا تتأثر.")}</p>
            <DialogFooter><Button variant="outline" onClick={() => setConfirmDel(null)}>{t("إلغاء")}</Button><Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>{t("حذف")}</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
