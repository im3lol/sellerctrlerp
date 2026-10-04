"use client";

import { useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { upsertPlanAction, togglePlanAction, deletePlanAction } from "@/app/actions/admin/plans";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type Plan = {
  id: string; name: string; priceMonthly: number; priceAnnual: number;
  enabledModules: string[]; maxUsers: number | null; storageGb: number | null;
  maxAutomations: number | null;
  isActive: boolean; sortOrder: number;
};

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const cap = (n: number | null) => (n == null ? "∞" : int(n));

function EditDialog({ plan, onClose }: { plan: Plan | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const isEdit = !!plan;
  const [name, setName] = useState(plan?.name ?? "");
  const [priceMonthly, setPriceMonthly] = useState(String(plan?.priceMonthly ?? ""));
  const [priceAnnual, setPriceAnnual] = useState(String(plan?.priceAnnual ?? ""));
  const [maxUsers, setMaxUsers] = useState(plan?.maxUsers != null ? String(plan.maxUsers) : "");
  const [storageGb, setStorageGb] = useState(plan?.storageGb != null ? String(plan.storageGb) : "");
  const [maxAutomations, setMaxAutomations] = useState(plan?.maxAutomations != null ? String(plan.maxAutomations) : "");
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 0));
  const [modules, setModules] = useState<string[]>(plan?.enabledModules ?? [...ALL_MODULES]);

  const toggle = (m: string) => setModules((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  const save = () => start(async () => {
    const r = await upsertPlanAction({
      id: plan?.id, name, priceMonthly: Number(priceMonthly) || 0, priceAnnual: Number(priceAnnual) || 0,
      enabledModules: modules, maxUsers: maxUsers ? Number(maxUsers) : null, storageGb: storageGb ? Number(storageGb) : null,
      maxAutomations: maxAutomations === "" ? null : Number(maxAutomations),
      sortOrder: Number(sortOrder) || 0,
    });
    if ("ok" in r) { toast.success("تم حفظ الباقة"); onClose(); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isEdit ? t("تعديل باقة") : t("باقة جديدة")}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>{t("اسم الباقة")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Pro" /></div>
          <div className="space-y-1.5"><Label>{t("الترتيب")}</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("السعر الشهري")}</Label><Input type="number" min="0" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("السعر السنوي")}</Label><Input type="number" min="0" value={priceAnnual} onChange={(e) => setPriceAnnual(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>{t("أقصى مستخدمين")}</Label><Input type="number" min="1" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder={t("بلا حد")} /></div>
          <div className="space-y-1.5"><Label>{t("التخزين (جيجابايت)")}</Label><Input type="number" min="1" value={storageGb} onChange={(e) => setStorageGb(e.target.value)} placeholder={t("بلا حد")} /></div>
          <div className="space-y-1.5"><Label>{t("قواعد الأتمتة")}</Label><Input type="number" min="0" value={maxAutomations} onChange={(e) => setMaxAutomations(e.target.value)} placeholder={t("بلا حد")} /></div>
        </div>
        <div className="space-y-2">
          <Label>{t("الوحدات المضمّنة")}</Label>
          <div className="grid grid-cols-2 gap-2 rounded-xl border p-3 sm:grid-cols-3">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(m)} className="size-4" />
                {t(MODULE_LABELS[m] ?? m)}
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("إلغاء")}</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ")}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export function PlansManager({ plans }: { plans: Plan[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<{ open: boolean; plan: Plan | null }>({ open: false, plan: null });
  const [confirmDel, setConfirmDel] = useState<Plan | null>(null);

  const toggle = (id: string) => start(async () => { const r = await togglePlanAction(id); if ("ok" in r) router.refresh(); else toast.error(r.error); });
  const del = (p: Plan) => start(async () => { const r = await deletePlanAction(p.id); if ("ok" in r) { toast.success("تم الحذف"); setConfirmDel(null); router.refresh(); } else toast.error(r.error); });

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between p-4">
          <span className="text-sm text-muted-foreground">{plans.length} {t("باقة")}</span>
          <Button size="sm" onClick={() => setDialog({ open: true, plan: null })}><Plus className="size-4" />{t("باقة جديدة")}</Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">{t("الباقة")}</TableHead>
              <TableHead className="text-start">{t("شهري / سنوي")}</TableHead>
              <TableHead className="text-start">{t("مستخدمون")}</TableHead>
              <TableHead className="text-start">{t("تخزين")}</TableHead>
              <TableHead className="text-start">{t("أتمتة")}</TableHead>
              <TableHead className="text-start">{t("الوحدات")}</TableHead>
              <TableHead className="text-start">{t("الحالة")}</TableHead>
              <TableHead className="text-start">{t("إجراءات")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t("لا توجد باقات — أنشئ أول باقة.")}</TableCell></TableRow>
            ) : plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-sm tabular-nums">{int(p.priceMonthly)} / {int(p.priceAnnual)}</TableCell>
                <TableCell className="text-sm">{cap(p.maxUsers)}</TableCell>
                <TableCell className="text-sm">{p.storageGb == null ? "∞" : fill(t("{0} جيجا"), [int(p.storageGb)])}</TableCell>
                <TableCell className="text-sm">{cap(p.maxAutomations)}</TableCell>
                <TableCell className="text-sm">{p.enabledModules.length}/{ALL_MODULES.length}</TableCell>
                <TableCell><Badge variant={p.isActive ? "default" : "outline"}>{p.isActive ? t("مفعّلة") : t("موقوفة")}</Badge></TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setDialog({ open: true, plan: p })} aria-label={t("تعديل")}><Pencil className="size-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => toggle(p.id)}>{p.isActive ? t("إيقاف") : t("تفعيل")}</Button>
                    <Button size="icon" variant="ghost" disabled={pending} onClick={() => setConfirmDel(p)} aria-label={t("حذف")}><Trash2 className="size-4 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={dialog.open} onOpenChange={(o) => !o && setDialog({ open: false, plan: null })}>
        {dialog.open && <EditDialog plan={dialog.plan} onClose={() => setDialog({ open: false, plan: null })} />}
      </Dialog>
      <Dialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        {confirmDel && (
          <DialogContent>
            <DialogHeader><DialogTitle>{t("حذف الباقة «")}{confirmDel.name}{t("»؟")}</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">{t("المؤسسات المشتركة تحتفظ بحدودها الحالية (لقطة)، لكن لن تظهر الباقة عند التفعيل بعد الآن.")}</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDel(null)}>{t("إلغاء")}</Button>
              <Button variant="destructive" disabled={pending} onClick={() => del(confirmDel)}>{t("حذف")}</Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </Card>
  );
}
