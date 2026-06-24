"use client";

import { useState, useTransition } from "react";
import { Loader2, KeyRound, Plus, Copy, Check, Settings2, Ban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  generateActivationCodeAction,
  revokeActivationCodeAction,
  applyCodeToOrgAction,
  setOrgSubscriptionAction,
  cancelOrgSubscriptionAction,
} from "@/app/actions/admin/licensing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type CustomerRow = {
  id: string; name: string; email: string | null;
  status: string; interval: string | null; planName: string | null;
  modules: string[]; expiresAt: string | null; daysLeft: number | null; live: boolean;
};
export type CodeRow = {
  id: string; hint: string; interval: string; durationMonths: number; modules: string[];
  planName: string | null; status: string; orgName: string | null; redeemedAt: string | null; createdAt: string;
};
type ModuleOption = { key: string; label: string };

const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—");

const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  NONE: { label: "بدون اشتراك", cls: "bg-muted text-muted-foreground" },
  TRIAL: { label: "تجريبي", cls: "bg-blue-100 text-blue-700" },
  ACTIVE: { label: "نشط", cls: "bg-emerald-100 text-emerald-700" },
  EXPIRED: { label: "منتهي", cls: "bg-amber-100 text-amber-700" },
  CANCELLED: { label: "ملغى", cls: "bg-destructive/10 text-destructive" },
};
const CODE_STATUS: Record<string, { label: string; cls: string }> = {
  UNUSED: { label: "غير مستخدم", cls: "bg-muted text-muted-foreground" },
  USED: { label: "مستخدم", cls: "bg-emerald-100 text-emerald-700" },
  REVOKED: { label: "ملغى", cls: "bg-destructive/10 text-destructive" },
};

function ModuleChecklist({ options, selected, onToggle }: { options: ModuleOption[]; selected: Set<string>; onToggle: (k: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {options.map((m) => (
        <label key={m.key} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm", selected.has(m.key) ? "border-primary bg-primary/5" : "")}>
          <input type="checkbox" checked={selected.has(m.key)} onChange={() => onToggle(m.key)} />
          {m.label}
        </label>
      ))}
    </div>
  );
}

function ManageDialog({ customer, moduleOptions }: { customer: CustomerRow; moduleOptions: ModuleOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set(customer.modules));
  const [status, setStatus] = useState(customer.status === "NONE" ? "ACTIVE" : customer.status);
  const [interval, setIntervalVal] = useState(customer.interval ?? "ANNUAL");
  const [extendMonths, setExtendMonths] = useState(0);
  const [planName, setPlanName] = useState(customer.planName ?? "");
  const [code, setCode] = useState("");

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const save = () => start(async () => {
    const r = await setOrgSubscriptionAction({
      organizationId: customer.id, modules: [...selected], status: status as "ACTIVE",
      interval: interval as "ANNUAL", extendMonths: Number(extendMonths) || 0, planName: planName || undefined,
    });
    if (r.ok) { toast.success("تم تحديث الاشتراك"); setOpen(false); } else toast.error(r.error ?? "تعذّر الحفظ");
  });
  const applyCode = () => start(async () => {
    if (!code.trim()) { toast.error("أدخل الكود"); return; }
    const r = await applyCodeToOrgAction({ code: code.trim(), organizationId: customer.id });
    if (r.ok) { toast.success("تم تفعيل الاشتراك بالكود"); setOpen(false); } else toast.error(r.error ?? "تعذّر التفعيل");
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="outline" size="sm"><Settings2 className="size-3.5" /> إدارة</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>اشتراك «{customer.name}»</DialogTitle>
          <DialogDescription>فعّل بكود جاهز، أو اضبط الموديولات والحالة يدويًا.</DialogDescription>
        </DialogHeader>

        {/* Activate by code */}
        <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
          <Label className="text-xs">التفعيل بكود</Label>
          <div className="flex gap-2">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" dir="ltr" className="font-mono" />
            <Button onClick={applyCode} disabled={pending}><KeyRound className="size-4" /> فعّل</Button>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <Label className="text-xs text-muted-foreground">أو ضبط يدوي</Label>
          <ModuleChecklist options={moduleOptions} selected={selected} onToggle={toggle} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs">الحالة</Label>
              <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="ACTIVE">نشط</option><option value="TRIAL">تجريبي</option>
                <option value="EXPIRED">منتهي</option><option value="CANCELLED">ملغى</option>
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">الدورة</Label>
              <select className={selectCls} value={interval} onChange={(e) => setIntervalVal(e.target.value)}>
                <option value="ANNUAL">سنوي</option><option value="MONTHLY">شهري</option>
              </select>
            </div>
            <div className="space-y-1"><Label className="text-xs">تمديد (أشهر)</Label><Input type="number" min="0" value={extendMonths} onChange={(e) => setExtendMonths(Number(e.target.value))} dir="ltr" /></div>
            <div className="space-y-1"><Label className="text-xs">اسم الخطة</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="اختياري" /></div>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} حفظ الضبط</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GenerateDialog({ moduleOptions }: { moduleOptions: ModuleOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [interval, setIntervalVal] = useState("ANNUAL");
  const [durationMonths, setDurationMonths] = useState(12);
  const [selected, setSelected] = useState<Set<string>>(new Set(moduleOptions.map((m) => m.key)));
  const [planName, setPlanName] = useState("");
  const [validDays, setValidDays] = useState(0);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (k: string) => setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const reset = () => { setIssued(null); setCopied(false); };

  const generate = () => start(async () => {
    const r = await generateActivationCodeAction({
      interval: interval as "ANNUAL", durationMonths: Number(durationMonths) || 12,
      modules: [...selected], planName: planName || undefined, validDays: Number(validDays) || undefined,
    });
    if (r.ok && r.code) { setIssued(r.code); toast.success("تم توليد الكود"); } else toast.error(r.error ?? "تعذّر التوليد");
  });
  const copy = () => { if (issued) { navigator.clipboard.writeText(issued); setCopied(true); toast.success("تم النسخ"); } };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> توليد كود تفعيل</Button></DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>توليد كود تفعيل</DialogTitle>
          <DialogDescription>الكود يظهر مرّة واحدة فقط — انسخه وأرسله للعميل. لا يمكن استرجاعه لاحقًا.</DialogDescription>
        </DialogHeader>

        {issued ? (
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-4 text-center">
              <div className="text-xs text-muted-foreground">كود التفعيل (انسخه الآن)</div>
              <div className="mt-1 select-all font-mono text-lg font-bold tracking-wider" dir="ltr">{issued}</div>
            </div>
            <Button onClick={copy} variant="outline" className="w-full">{copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />} {copied ? "تم النسخ" : "نسخ الكود"}</Button>
            <Button onClick={() => { reset(); }} className="w-full">توليد كود آخر</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">الموديولات المتاحة</Label>
              <div className="mt-1"><ModuleChecklist options={moduleOptions} selected={selected} onToggle={toggle} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">الدورة</Label>
                <select className={selectCls} value={interval} onChange={(e) => { setIntervalVal(e.target.value); setDurationMonths(e.target.value === "MONTHLY" ? 1 : 12); }}>
                  <option value="ANNUAL">سنوي</option><option value="MONTHLY">شهري</option>
                </select>
              </div>
              <div className="space-y-1"><Label className="text-xs">المدة (أشهر)</Label><Input type="number" min="1" value={durationMonths} onChange={(e) => setDurationMonths(Number(e.target.value))} dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-xs">اسم الخطة</Label><Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="اختياري" /></div>
              <div className="space-y-1"><Label className="text-xs">صلاحية الكود (أيام)</Label><Input type="number" min="0" value={validDays} onChange={(e) => setValidDays(Number(e.target.value))} placeholder="0 = دائم" dir="ltr" /></div>
            </div>
            <DialogFooter><Button onClick={generate} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />} توليد</Button></DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function LicensingManager({ customers, codes, moduleOptions }: { customers: CustomerRow[]; codes: CodeRow[]; moduleOptions: ModuleOption[] }) {
  const [pending, start] = useTransition();
  const labelOf = (k: string) => moduleOptions.find((m) => m.key === k)?.label ?? k;

  const cancel = (c: CustomerRow) => {
    if (!window.confirm(`إلغاء اشتراك «${c.name}»؟`)) return;
    start(async () => { const r = await cancelOrgSubscriptionAction(c.id); if (r.ok) toast.success("تم الإلغاء"); else toast.error(r.error ?? "تعذّر الإلغاء"); });
  };
  const revoke = (id: string) => {
    if (!window.confirm("إلغاء هذا الكود؟")) return;
    start(async () => { const r = await revokeActivationCodeAction(id); if (r.ok) toast.success("تم إلغاء الكود"); else toast.error(r.error ?? "تعذّر الإلغاء"); });
  };

  return (
    <div className="space-y-6">
      {/* Customers */}
      <Card>
        <CardHeader><CardTitle>العملاء والاشتراكات</CardTitle><CardDescription>الموديولات المتاحة وحالة الاشتراك لكل عميل.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b text-start [&>th]:p-2 [&>th]:text-start">
                <th>العميل</th><th>الحالة</th><th>الدورة</th><th>الموديولات</th><th>الانتهاء</th><th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const st = SUB_STATUS[c.status] ?? SUB_STATUS.NONE;
                return (
                  <tr key={c.id} className="border-b [&>td]:p-2 [&>td]:align-middle">
                    <td><div className="font-medium">{c.name}</div>{c.email && <div className="text-xs text-muted-foreground" dir="ltr">{c.email}</div>}</td>
                    <td><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span></td>
                    <td className="text-xs text-muted-foreground">{c.interval === "MONTHLY" ? "شهري" : c.interval === "ANNUAL" ? "سنوي" : "—"}</td>
                    <td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.modules.length ? c.modules.map((m) => <Badge key={m} variant="secondary" className="text-[10px]">{labelOf(m)}</Badge>) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="text-xs tabular-nums">{fmtDate(c.expiresAt)}{c.daysLeft != null && c.live && c.daysLeft <= 30 && <span className="ms-1 text-amber-600">({c.daysLeft}ي)</span>}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <ManageDialog customer={c} moduleOptions={moduleOptions} />
                        {c.status !== "CANCELLED" && c.status !== "NONE" && <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => cancel(c)}><Ban className="size-3.5" /></Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Activation codes */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <div><CardTitle>أكواد التفعيل</CardTitle><CardDescription>مشفّرة ومخزّنة كبصمة فقط — تُعرض مرة واحدة عند التوليد.</CardDescription></div>
          <GenerateDialog moduleOptions={moduleOptions} />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {codes.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">لا أكواد بعد.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b [&>th]:p-2 [&>th]:text-start">
                  <th>الكود</th><th>الحالة</th><th>الدورة/المدة</th><th>الموديولات</th><th>العميل</th><th></th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => {
                  const st = CODE_STATUS[c.status] ?? CODE_STATUS.UNUSED;
                  return (
                    <tr key={c.id} className="border-b [&>td]:p-2 [&>td]:align-middle">
                      <td className="font-mono text-xs" dir="ltr">{c.hint}</td>
                      <td><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span></td>
                      <td className="text-xs text-muted-foreground">{c.interval === "MONTHLY" ? "شهري" : "سنوي"} · {c.durationMonths} شهر</td>
                      <td><div className="flex max-w-xs flex-wrap gap-1">{c.modules.map((m) => <Badge key={m} variant="secondary" className="text-[10px]">{labelOf(m)}</Badge>)}</div></td>
                      <td className="text-xs">{c.orgName ?? "—"}</td>
                      <td className="text-end">{c.status === "UNUSED" && <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => revoke(c.id)}><Trash2 className="size-3.5" /></Button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
