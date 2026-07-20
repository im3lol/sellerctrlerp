"use client";

import Link from "next/link";
import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { setSubscriptionAction } from "@/app/actions/admin/licensing";
import { impersonateTenantAction } from "@/app/actions/admin/impersonate";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { selectCls } from "@/lib/utils";

export type OrgSub = { id: string; name: string; status: string; planId: string; planName: string; interval: string; price: number; enabledModules: string[]; maxUsers: number | null; storageGb: number | null; members: number; storageBytes: number; expiresAt: string };
export type PlanOpt = { id: string; name: string; priceMonthly: number; priceAnnual: number; enabledModules: string[]; maxUsers: number | null; storageGb: number | null };

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ك.ب` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} م.ب` : `${(b / 1024 ** 3).toFixed(2)} ج.ب`);
const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIVE: { label: "مفعّل", variant: "default" }, TRIAL: { label: "تجريبي", variant: "secondary" },
  EXPIRED: { label: "منتهٍ", variant: "destructive" }, CANCELLED: { label: "ملغى", variant: "destructive" },
  NONE: { label: "بلا اشتراك", variant: "outline" },
};

function EditDialog({ org, plans, onClose }: { org: OrgSub; plans: PlanOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(org.status);
  const [planId, setPlanId] = useState(org.planId);
  const [planName, setPlanName] = useState(org.planName);
  const [interval, setInterval] = useState(org.interval);
  const [price, setPrice] = useState(String(org.price));
  const [maxUsers, setMaxUsers] = useState(org.maxUsers != null ? String(org.maxUsers) : "");
  const [storageGb, setStorageGb] = useState(org.storageGb != null ? String(org.storageGb) : "");
  const [expiresAt, setExpiresAt] = useState(org.expiresAt);
  const [couponCode, setCouponCode] = useState("");
  const [modules, setModules] = useState<string[]>(org.enabledModules);

  const toggle = (m: string) => setModules((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m]);
  const allOn = () => setModules([...ALL_MODULES]);

  // Picking a plan snapshots its modules/caps/price into the form (still editable as an override).
  const pickPlan = (id: string) => {
    setPlanId(id);
    const p = plans.find((x) => x.id === id);
    if (!p) return;
    setPlanName(p.name);
    setModules(p.enabledModules);
    setMaxUsers(p.maxUsers != null ? String(p.maxUsers) : "");
    setStorageGb(p.storageGb != null ? String(p.storageGb) : "");
    setPrice(String(interval === "ANNUAL" ? p.priceAnnual : p.priceMonthly));
  };

  const save = () => start(async () => {
    const r = await setSubscriptionAction({ organizationId: org.id, status, planId: planId || null, planName, interval: interval || null, price: Number(price) || 0, expiresAt: expiresAt || null, enabledModules: modules, maxUsers: maxUsers ? Number(maxUsers) : null, storageGb: storageGb ? Number(storageGb) : null, couponCode: couponCode || null });
    if ("ok" in r) { toast.success(r.discounted != null ? `تم — بعد الخصم: ${r.discounted.toLocaleString("ar-EG")}` : "تم حفظ الاشتراك"); onClose(); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <DialogContent dir="rtl">
      <DialogHeader>
        <DialogTitle>ترخيص — {org.name}</DialogTitle>
        <DialogDescription>اختر باقة لملء الحدود تلقائياً، أو عدّلها يدوياً. «مفعّل» بلا تاريخ انتهاء = دائم.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        {plans.length > 0 && (
          <div className="space-y-1.5">
            <Label>الباقة</Label>
            <select className={selectCls} value={planId} onChange={(e) => pickPlan(e.target.value)}>
              <option value="">— مخصّص —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>الحالة</Label>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label>تاريخ الانتهاء</Label><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>الدورة</Label>
            <select className={selectCls} value={interval} onChange={(e) => setInterval(e.target.value)}>
              <option value="">—</option><option value="MONTHLY">شهري</option><option value="ANNUAL">سنوي</option>
            </select>
          </div>
          <div className="space-y-1.5"><Label>السعر / الدورة</Label><Input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>أقصى مستخدمين</Label><Input type="number" min="1" value={maxUsers} onChange={(e) => setMaxUsers(e.target.value)} placeholder="بلا حد" /></div>
          <div className="space-y-1.5"><Label>التخزين (جيجابايت)</Label><Input type="number" min="1" value={storageGb} onChange={(e) => setStorageGb(e.target.value)} placeholder="بلا حد" /></div>
          <div className="space-y-1.5"><Label>كوبون خصم</Label><Input value={couponCode} onChange={(e) => setCouponCode(e.target.value.toUpperCase())} placeholder="اختياري" className="font-mono" /></div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between"><Label>الوحدات المفعّلة</Label><button type="button" onClick={allOn} className="text-xs text-primary hover:underline">تفعيل الكل</button></div>
          <div className="grid grid-cols-2 gap-2 rounded-xl border p-3 sm:grid-cols-3">
            {ALL_MODULES.map((m) => (
              <label key={m} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={modules.includes(m)} onChange={() => toggle(m)} className="size-4" />
                {MODULE_LABELS[m] ?? m}
              </label>
            ))}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ</Button>
      </DialogFooter>
    </DialogContent>
  );
}

const DAY = 86_400_000;
const mrrOf = (o: OrgSub) => (o.status === "ACTIVE" && (!o.expiresAt || new Date(o.expiresAt).getTime() > Date.now()) ? (o.interval === "ANNUAL" ? o.price / 12 : o.price) : 0);
const daysLeftOf = (o: OrgSub) => (o.expiresAt ? Math.ceil((new Date(o.expiresAt).getTime() - Date.now()) / DAY) : null);
const isAtRisk = (o: OrgSub) => { const d = daysLeftOf(o); return o.status === "EXPIRED" || o.status === "CANCELLED" || (o.status === "ACTIVE" && d != null && d <= 7); };

export function LicensingManager({ orgs, plans }: { orgs: OrgSub[]; plans: PlanOpt[] }) {
  const [editing, setEditing] = useState<OrgSub | null>(null);
  const [imp, startImp] = useTransition();
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("ALL");
  const [sortK, setSortK] = useState("name");
  const [riskOnly, setRiskOnly] = useState(false);
  const support = (id: string) => startImp(async () => {
    const r = await impersonateTenantAction(id); // redirects on success; returns on error
    if (r && "error" in r) toast.error(r.error);
  });

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let v = orgs.filter((o) =>
      (!needle || o.name.toLowerCase().includes(needle)) &&
      (statusF === "ALL" || o.status === statusF) &&
      (!riskOnly || isAtRisk(o)),
    );
    const cmp: Record<string, (a: OrgSub, b: OrgSub) => number> = {
      name: (a, b) => a.name.localeCompare(b.name, "ar"),
      mrr: (a, b) => mrrOf(b) - mrrOf(a),
      members: (a, b) => b.members - a.members,
      expiry: (a, b) => (daysLeftOf(a) ?? Infinity) - (daysLeftOf(b) ?? Infinity),
    };
    return [...v].sort(cmp[sortK] ?? cmp.name);
  }, [orgs, q, statusF, sortK, riskOnly]);

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المؤسسة…" className="h-9 max-w-xs" />
          <select value={statusF} onChange={(e) => setStatusF(e.target.value)} className={`${selectCls} h-9 w-auto`}>
            <option value="ALL">كل الحالات</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={sortK} onChange={(e) => setSortK(e.target.value)} className={`${selectCls} h-9 w-auto`}>
            <option value="name">ترتيب: الاسم</option>
            <option value="mrr">ترتيب: الإيراد</option>
            <option value="expiry">ترتيب: الأقرب انتهاءً</option>
            <option value="members">ترتيب: المستخدمون</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><input type="checkbox" checked={riskOnly} onChange={(e) => setRiskOnly(e.target.checked)} className="size-4" />معرّض للخطر فقط</label>
          <span className="ms-auto text-sm text-muted-foreground tabular-nums">{view.length} / {orgs.length}</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-start">المؤسسة</TableHead>
              <TableHead className="text-start">الحالة</TableHead>
              <TableHead className="text-start">الباقة</TableHead>
              <TableHead className="text-start">المستخدمون</TableHead>
              <TableHead className="text-start">التخزين</TableHead>
              <TableHead className="text-start">الانتهاء</TableHead>
              <TableHead className="text-start">الوحدات</TableHead>
              <TableHead className="text-start">إجراءات</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-10 text-center text-muted-foreground">لا مؤسسات مطابقة.</TableCell></TableRow>
            )}
            {view.map((o) => {
              const st = STATUS[o.status] ?? STATUS.NONE;
              return (
                <TableRow key={o.id}>
                  <TableCell className="font-medium"><Link href={`/admin/tenants/${o.id}`} className="hover:text-primary hover:underline">{o.name}</Link></TableCell>
                  <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                  <TableCell>{o.planName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-sm tabular-nums">{o.members.toLocaleString("ar-EG")}{o.maxUsers != null ? ` / ${o.maxUsers}` : ""}</TableCell>
                  <TableCell className="text-sm tabular-nums">{fmtBytes(o.storageBytes)}{o.storageGb != null ? ` / ${o.storageGb} ج.ب` : ""}</TableCell>
                  <TableCell className="text-sm">{o.expiresAt || <span className="text-muted-foreground">بلا انتهاء</span>}</TableCell>
                  <TableCell className="text-sm">{o.status === "NONE" ? "الكل (افتراضي)" : `${o.enabledModules.length}/${ALL_MODULES.length}`}</TableCell>
                  <TableCell>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setEditing(o)}>تعديل / تفعيل</Button>
                      <Button size="sm" variant="ghost" disabled={imp} onClick={() => support(o.id)} title="دخول لمساحة المؤسسة للدعم">دخول للدعم</Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditDialog key={editing.id} org={editing} plans={plans} onClose={() => setEditing(null)} />}
      </Dialog>
    </Card>
  );
}
