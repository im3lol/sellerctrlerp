"use client";

import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Plus, Pencil, Trophy, X, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  saveOpportunityAction,
  moveOpportunityStageAction,
  setOpportunityStatusAction,
  deleteOpportunityAction,
  type SaveOppState,
} from "@/app/actions/erp/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type Stage = { id: string; name: string; sortOrder: number; isWon: boolean; isLost: boolean };
export type Opp = {
  id: string; number: string; name: string;
  customerId: string | null; customerName: string | null;
  contactName: string | null; phone: string | null; email: string | null;
  stageId: string | null; expectedRevenue: string; probability: number;
  status: string; source: string | null; notes: string | null;
  expectedCloseDate: Date | string | null; salesperson: string | null;
};

const money = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const selectCls = "flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function SubmitBtn() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>;
}

function OppDialog({
  open, onOpenChange, editing, stages, customers,
}: { open: boolean; onOpenChange: (o: boolean) => void; editing: Opp | null; stages: Stage[]; customers: { id: string; name: string }[] }) {
  const [state, formAction] = useActionState<SaveOppState, FormData>(saveOpportunityAction, {});
  useEffect(() => {
    if (state.ok) { toast.success("تم الحفظ"); onOpenChange(false); }
    else if (state.error) toast.error(state.error);
  }, [state, onOpenChange]);

  const closeDate = editing?.expectedCloseDate ? new Date(editing.expectedCloseDate).toISOString().slice(0, 10) : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form action={formAction} className="space-y-4">
          <DialogHeader><DialogTitle>{editing ? "تعديل فرصة" : "فرصة جديدة"}</DialogTitle></DialogHeader>
          {editing && <input type="hidden" name="id" value={editing.id} />}
          <div className="space-y-2"><Label htmlFor="opp-name">اسم الفرصة</Label><Input id="opp-name" name="name" defaultValue={editing?.name} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="opp-customer">العميل</Label>
              <select id="opp-customer" name="customerId" defaultValue={editing?.customerId ?? "none"} className={cn(selectCls, "h-9 text-sm")}>
                <option value="none">— بدون —</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="opp-stage">المرحلة</Label>
              <select id="opp-stage" name="stageId" defaultValue={editing?.stageId ?? ""} className={cn(selectCls, "h-9 text-sm")}>
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label htmlFor="opp-rev">الإيراد المتوقّع</Label><Input id="opp-rev" name="expectedRevenue" type="number" step="0.01" min="0" defaultValue={editing ? Number(editing.expectedRevenue) : 0} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="opp-prob">الاحتمالية (%)</Label><Input id="opp-prob" name="probability" type="number" min="0" max="100" defaultValue={editing?.probability ?? 0} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="opp-contact">جهة الاتصال</Label><Input id="opp-contact" name="contactName" defaultValue={editing?.contactName ?? ""} /></div>
            <div className="space-y-2"><Label htmlFor="opp-phone">الهاتف</Label><Input id="opp-phone" name="phone" defaultValue={editing?.phone ?? ""} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="opp-close">تاريخ الإغلاق المتوقّع</Label><Input id="opp-close" name="expectedCloseDate" type="date" defaultValue={closeDate} dir="ltr" /></div>
            <div className="space-y-2"><Label htmlFor="opp-source">المصدر</Label><Input id="opp-source" name="source" defaultValue={editing?.source ?? ""} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="opp-notes">ملاحظات</Label><Textarea id="opp-notes" name="notes" defaultValue={editing?.notes ?? ""} rows={2} /></div>
          <DialogFooter><SubmitBtn /></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CrmPipeline({
  stages, opportunities, customers, canManage,
}: { stages: Stage[]; opportunities: Opp[]; customers: { id: string; name: string }[]; canManage: boolean }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Opp | null>(null);
  const [pending, startTransition] = useTransition();

  const byStage = useMemo(() => {
    const m = new Map<string, Opp[]>();
    for (const s of stages) m.set(s.id, []);
    for (const o of opportunities) {
      if (o.status === "LOST") continue; // lost cards leave the board
      if (o.stageId && m.has(o.stageId)) m.get(o.stageId)!.push(o);
    }
    return m;
  }, [stages, opportunities]);

  const openCreate = () => { setEditing(null); setOpen(true); };
  const openEdit = (o: Opp) => { setEditing(o); setOpen(true); };

  const move = (o: Opp, stageId: string) => startTransition(async () => {
    const r = await moveOpportunityStageAction(o.id, stageId);
    if (!r.ok) toast.error(r.error ?? "تعذّر النقل");
  });
  const setStatus = (o: Opp, status: "WON" | "LOST" | "OPEN") => startTransition(async () => {
    const r = await setOpportunityStatusAction(o.id, status, status === "LOST" ? "—" : undefined);
    if (r.ok) toast.success(status === "WON" ? "تم تعليمها مكسوبة" : status === "LOST" ? "تم تعليمها خاسرة" : "أُعيد فتحها");
    else toast.error(r.error ?? "تعذّر التنفيذ");
  });
  const remove = (o: Opp) => {
    if (!window.confirm(`حذف الفرصة «${o.name}»؟`)) return;
    startTransition(async () => {
      const r = await deleteOpportunityAction(o.id);
      if (r.ok) toast.success("تم الحذف"); else toast.error(r.error ?? "تعذّر الحذف");
    });
  };

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={openCreate}><Plus className="size-4" />فرصة جديدة</Button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((s) => {
          const cards = byStage.get(s.id) ?? [];
          const total = cards.reduce((sum, c) => sum + Number(c.expectedRevenue), 0);
          return (
            <div key={s.id} className="flex w-72 shrink-0 flex-col rounded-2xl bg-muted/40 p-2">
              <div className="flex items-center justify-between px-2 py-1.5">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  {s.isWon && <Trophy className="size-3.5 text-emerald-600" />}
                  {s.name}
                  <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground tabular-nums">{cards.length}</span>
                </div>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">{money(total)}</span>
              </div>
              <div className="flex flex-col gap-2">
                {cards.length === 0 ? (
                  <div className="rounded-xl border border-dashed py-6 text-center text-xs text-muted-foreground">لا فرص</div>
                ) : cards.map((o) => (
                  <div key={o.id} className="group rounded-xl border bg-card p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{o.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{o.customerName ?? o.contactName ?? "—"}</div>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">{o.number}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs">
                      <span className="font-semibold tabular-nums text-emerald-600">{money(Number(o.expectedRevenue))}</span>
                      <span className="rounded-full bg-muted px-2 py-0.5 tabular-nums text-muted-foreground">{o.probability}%</span>
                    </div>
                    {o.salesperson && <div className="mt-1 truncate text-[11px] text-muted-foreground">{o.salesperson}</div>}
                    {canManage && (
                      <div className="mt-2 space-y-1.5 border-t pt-2">
                        <select
                          className={selectCls}
                          value={o.stageId ?? ""}
                          disabled={pending}
                          onChange={(e) => move(o, e.target.value)}
                          aria-label="نقل المرحلة"
                        >
                          {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                        </select>
                        <div className="flex items-center gap-1">
                          {o.status !== "WON" ? (
                            <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs text-emerald-600" disabled={pending} onClick={() => setStatus(o, "WON")}><Trophy className="size-3.5" />كسب</Button>
                          ) : (
                            <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" disabled={pending} onClick={() => setStatus(o, "OPEN")}>إعادة فتح</Button>
                          )}
                          <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs text-amber-600" disabled={pending} onClick={() => setStatus(o, "LOST")}><X className="size-3.5" />خسارة</Button>
                          <Button variant="ghost" size="icon" className="size-7" onClick={() => openEdit(o)} aria-label="تعديل"><Pencil className="size-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="size-7" disabled={pending} onClick={() => remove(o)} aria-label="حذف"><Trash2 className="size-3.5 text-destructive" /></Button>
                        </div>
                        {o.customerId && (
                          <a href={`/erp/sales/orders/new`} className="block rounded-md bg-primary/10 py-1 text-center text-[11px] font-medium text-primary hover:bg-primary/20">إنشاء أمر بيع ←</a>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <OppDialog key={editing?.id ?? "new"} open={open} onOpenChange={setOpen} editing={editing} stages={stages} customers={customers} />
    </div>
  );
}
