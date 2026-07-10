"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { upsertRecurringSalesInvoiceAction, toggleRecurringSalesInvoiceAction, deleteRecurringSalesInvoiceAction } from "@/app/actions/erp/recurring-sales-invoices";
import { FREQUENCY_LABELS, type Frequency } from "@/lib/erp/recurring-shared";
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

type Customer = { id: string; nameAr: string };
type Item = { id: string; nameAr: string | null; sellPrice: string | null };
type Line = { itemId: string; quantity: number; unitPrice: number; discountAmount: number; taxAmount: number };
export type RSI = { id: string; customerId: string; customer: string; frequency: string; nextRunDate: string; isActive: boolean; notes: string; total: number; lines: Line[] };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nl = (): Line => ({ itemId: "", quantity: 1, unitPrice: 0, discountAmount: 0, taxAmount: 0 });

function EditDialog({ rsi, customers, items, onClose }: { rsi: RSI | null; customers: Customer[]; items: Item[]; onClose: () => void }) {
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
    else toast.error(r.error ?? "تعذّر الحفظ");
  });

  return (
    <DialogContent dir="rtl" className="max-w-2xl">
      <DialogHeader><DialogTitle>{rsi ? "تعديل فاتورة دورية" : "فاتورة دورية جديدة"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5"><Label>العميل</Label><CellCombobox selectedLabel={custLabel.get(customerId) ?? ""} options={custOptions} onSelect={setCustomerId} placeholder="ابحث…" /></div>
          <div className="space-y-1.5"><Label>التكرار</Label><select className={selectCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>{Object.entries(FREQUENCY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          <div className="space-y-1.5"><Label>أول تنفيذ</Label><Input type="date" value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} /></div>
        </div>
        <div className="rounded-xl border">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="w-20 text-start">كمية</TableHead><TableHead className="w-24 text-start">سعر</TableHead><TableHead className="w-20 text-start">خصم</TableHead><TableHead className="w-20 text-start">ضريبة</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>
              {lines.map((l, i) => (
                <TableRow key={i}>
                  <TableCell><ItemPicker selectedLabel={items.find((it) => it.id === l.itemId)?.nameAr ?? ""} onSelect={(it) => pickItem(i, it)} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.discountAmount} onChange={(e) => setLine(i, { discountAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" value={l.taxAmount} onChange={(e) => setLine(i, { taxAmount: Number(e.target.value) })} /></TableCell>
                  <TableCell><Button variant="ghost" size="icon" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls))} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, nl()])}><Plus className="size-4" />إضافة بند</Button>
          <span className="text-sm">الإجمالي: <b>{fmt(total)}</b></span>
        </div>
        <div className="space-y-1.5"><Label>ملاحظات</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="اختياري" /></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>إلغاء</Button><Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button></DialogFooter>
    </DialogContent>
  );
}

export function RecurringSalesInvoicesManager({ items: templates, customers, itemsList }: { items: RSI[]; customers: Customer[]; itemsList: Item[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; rsi: RSI | null }>({ open: false, rsi: null });
  const [confirmDel, setConfirmDel] = useState<RSI | null>(null);

  const toggle = (id: string) => start(async () => { const r = await toggleRecurringSalesInvoiceAction(id); if (r.ok) router.refresh(); else toast.error(r.error ?? ""); });
  const del = (rsi: RSI) => start(async () => { const r = await deleteRecurringSalesInvoiceAction(rsi.id); if (r.ok) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error ?? ""); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{templates.length} قالب — يولّد فاتورة بيع كمسودة تلقائياً في موعده</span>
          <Button size="sm" onClick={() => setDialog({ open: true, rsi: null })}><Plus className="size-4" />قالب جديد</Button>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead className="text-start">العميل</TableHead><TableHead className="text-start">التكرار</TableHead>
            <TableHead className="text-start">التنفيذ القادم</TableHead><TableHead className="text-end">الإجمالي</TableHead>
            <TableHead className="text-start">الحالة</TableHead><TableHead className="text-start">إجراءات</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {templates.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="py-10 text-center text-muted-foreground">لا توجد قوالب — أنشئ أول قالب.</TableCell></TableRow>
            ) : templates.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.customer}</TableCell>
                <TableCell>{FREQUENCY_LABELS[r.frequency as Frequency] ?? r.frequency}</TableCell>
                <TableCell className="tabular-nums">{r.nextRunDate}</TableCell>
                <TableCell className="text-end tabular-nums">{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={r.isActive ? "default" : "outline"}>{r.isActive ? "مفعّل" : "موقوف"}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, rsi: r })} aria-label="تعديل"><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(r.id)}>{r.isActive ? "إيقاف" : "تفعيل"}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(r)} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, rsi: null })}>
        {dialog.open && <EditDialog rsi={dialog.rsi} customers={customers} items={itemsList} onClose={() => setDialog({ open: false, rsi: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent dir="rtl">
            <DialogHeader><DialogTitle>حذف القالب؟</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">الفواتير التي وُلّدت بالفعل لا تتأثر.</p>
            <DialogFooter><Button variant="outline" onClick={() => setConfirmDel(null)}>إلغاء</Button><Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>حذف</Button></DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
