"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  Loader2, KeyRound, Plus, Copy, Check, Settings2, Ban, Trash2,
  ExternalLink, Boxes, CreditCard, Clock, Wrench,
} from "lucide-react";
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
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { CustomerRow, CodeRow } from "@/lib/erp/platform-data";

export type ModuleOption = { key: string; label: string };

const fmtDate = (iso: string | Date | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" }) : "—";
const money = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SUB_STATUS: Record<string, { label: string; cls: string }> = {
  NONE:      { label: "بدون اشتراك", cls: "bg-muted text-muted-foreground" },
  TRIAL:     { label: "تجريبي",       cls: "bg-blue-100 text-blue-700" },
  ACTIVE:    { label: "نشط",          cls: "bg-emerald-100 text-emerald-700" },
  EXPIRED:   { label: "منتهي",        cls: "bg-amber-100 text-amber-700" },
  CANCELLED: { label: "ملغى",         cls: "bg-destructive/10 text-destructive" },
};
export const CODE_STATUS: Record<string, { label: string; cls: string }> = {
  UNUSED:  { label: "غير مستخدم", cls: "bg-muted text-muted-foreground" },
  USED:    { label: "مستخدم",      cls: "bg-emerald-100 text-emerald-700" },
  REVOKED: { label: "ملغى",        cls: "bg-destructive/10 text-destructive" },
};

/* ─── Shared: Section header ─── */
function SectionHeader({
  icon: Icon, title, action,
}: { icon: React.ElementType; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 text-muted-foreground" />
        {title}
      </div>
      {action}
    </div>
  );
}

/* ─── Shared: Module checklist ─── */
function ModuleChecklist({ options, selected, onToggle }: {
  options: ModuleOption[];
  selected: Set<string>;
  onToggle: (k: string) => void;
}) {
  const allSelected = options.every((m) => selected.has(m.key));
  const toggleAll = () => {
    if (allSelected) options.forEach((m) => { if (selected.has(m.key)) onToggle(m.key); });
    else options.forEach((m) => { if (!selected.has(m.key)) onToggle(m.key); });
  };
  return (
    <div className="space-y-2">
      <SectionHeader
        icon={Boxes}
        title={`الموديولات (${selected.size} / ${options.length})`}
        action={
          <button onClick={toggleAll} className="text-xs text-primary hover:underline">
            {allSelected ? "إلغاء الكل" : "تحديد الكل"}
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-1.5">
        {options.map((m) => (
          <label
            key={m.key}
            className={cn(
              "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors select-none",
              selected.has(m.key)
                ? "border-primary/50 bg-primary/5 text-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground/40",
            )}
          >
            <input
              type="checkbox"
              className="accent-primary"
              checked={selected.has(m.key)}
              onChange={() => onToggle(m.key)}
            />
            {m.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/* ─── ManageDialog ─── */
export function ManageDialog({ customer, moduleOptions }: { customer: CustomerRow; moduleOptions: ModuleOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set(customer.modules));
  const [status, setStatus] = useState(customer.status === "NONE" ? "ACTIVE" : customer.status);
  const [interval, setIntervalVal] = useState(customer.interval ?? "ANNUAL");
  const [extendMonths, setExtendMonths] = useState(0);
  const [planName, setPlanName] = useState(customer.planName ?? "");
  const [price, setPrice] = useState(customer.price || 0);
  const [code, setCode] = useState("");

  const toggle = (k: string) =>
    setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const save = () =>
    start(async () => {
      const r = await setOrgSubscriptionAction({
        organizationId: customer.id,
        modules: [...selected],
        status: status as "ACTIVE",
        interval: interval as "ANNUAL",
        extendMonths: Number(extendMonths) || 0,
        planName: planName || undefined,
        price: Number(price) || 0,
      });
      if (r.ok) { toast.success("تم تحديث الاشتراك"); setOpen(false); }
      else toast.error(r.error ?? "تعذّر الحفظ");
    });

  const applyCode = () =>
    start(async () => {
      if (!code.trim()) { toast.error("أدخل الكود"); return; }
      const r = await applyCodeToOrgAction({ code: code.trim(), organizationId: customer.id });
      if (r.ok) { toast.success("تم تفعيل الاشتراك بالكود"); setOpen(false); }
      else toast.error(r.error ?? "تعذّر التفعيل");
    });

  const st = SUB_STATUS[customer.status] ?? SUB_STATUS.NONE;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm"><Settings2 className="size-3.5" /> إدارة</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>اشتراك «{customer.name}»</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
            {customer.interval && (
              <span className="text-xs text-muted-foreground">
                {customer.interval === "MONTHLY" ? "شهري" : "سنوي"}
              </span>
            )}
            {customer.price > 0 && (
              <span className="text-xs text-muted-foreground">{money(customer.price)} / دورة</span>
            )}
          </div>
        </DialogHeader>

        <Tabs defaultValue="code">
          <TabsList className="w-full">
            <TabsTrigger value="code" className="flex-1 gap-1.5">
              <KeyRound className="size-3.5" /> تفعيل بكود
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <Wrench className="size-3.5" /> ضبط يدوي
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: activate by code */}
          <TabsContent value="code" className="space-y-3 pt-3">
            <p className="text-sm text-muted-foreground">
              أدخل كود تفعيل صالح لتطبيقه على هذا العميل.
            </p>
            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                dir="ltr"
                className="font-mono"
              />
              <Button onClick={applyCode} disabled={pending || !code.trim()}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                فعّل
              </Button>
            </div>
          </TabsContent>

          {/* Tab 2: manual settings */}
          <TabsContent value="manual" className="space-y-4 pt-3">
            <ModuleChecklist options={moduleOptions} selected={selected} onToggle={toggle} />

            <Separator />

            <div className="space-y-3">
              <SectionHeader icon={CreditCard} title="بيانات الفاتورة" />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الحالة</Label>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">نشط</SelectItem>
                      <SelectItem value="TRIAL">تجريبي</SelectItem>
                      <SelectItem value="EXPIRED">منتهي</SelectItem>
                      <SelectItem value="CANCELLED">ملغى</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الدورة</Label>
                  <Select value={interval} onValueChange={setIntervalVal}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL">سنوي</SelectItem>
                      <SelectItem value="MONTHLY">شهري</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">السعر / الدورة</Label>
                  <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(Number(e.target.value))} dir="ltr" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">تمديد (أشهر)</Label>
                  <Input type="number" min="0" value={extendMonths} onChange={(e) => setExtendMonths(Number(e.target.value))} dir="ltr" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs text-muted-foreground">اسم الخطة</Label>
                  <Input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="مثال: Business Pro" />
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={save} disabled={pending}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                حفظ التغييرات
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

/* ─── GenerateDialog ─── */
export function GenerateDialog({ moduleOptions }: { moduleOptions: ModuleOption[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [interval, setIntervalVal] = useState("ANNUAL");
  const [durationMonths, setDurationMonths] = useState(12);
  const [selected, setSelected] = useState<Set<string>>(new Set(moduleOptions.map((m) => m.key)));
  const [validDays, setValidDays] = useState(0);
  const [issued, setIssued] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const toggle = (k: string) =>
    setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const reset = () => { setIssued(null); setCopied(false); };

  const generate = () =>
    start(async () => {
      const r = await generateActivationCodeAction({
        interval: interval as "ANNUAL",
        durationMonths: Number(durationMonths) || 12,
        modules: [...selected],
        validDays: Number(validDays) || undefined,
      });
      if (r.ok && r.code) { setIssued(r.code); toast.success("تم توليد الكود"); }
      else toast.error(r.error ?? "تعذّر التوليد");
    });

  const copy = () => {
    if (issued) { navigator.clipboard.writeText(issued); setCopied(true); toast.success("تم النسخ"); }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> توليد كود تفعيل</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>توليد كود تفعيل</DialogTitle>
          <p className="text-sm text-muted-foreground">الكود يظهر مرّة واحدة فقط — انسخه وأرسله للعميل.</p>
        </DialogHeader>

        {issued ? (
          /* ── Issued: show & copy ── */
          <div className="space-y-3 py-2">
            <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-5 text-center">
              <p className="mb-2 text-xs text-muted-foreground">كود التفعيل — انسخه الآن</p>
              <p className="select-all font-mono text-lg font-bold tracking-wider" dir="ltr">{issued}</p>
            </div>
            <Button onClick={copy} variant="outline" className="w-full">
              {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
              {copied ? "تم النسخ" : "نسخ الكود"}
            </Button>
            <Button onClick={reset} variant="ghost" className="w-full">توليد كود آخر</Button>
          </div>
        ) : (
          /* ── Form: 2 sections (no price/plan — set those on the subscription) ── */
          <div className="space-y-5 py-1">
            {/* 1. Modules */}
            <ModuleChecklist options={moduleOptions} selected={selected} onToggle={toggle} />

            <Separator />

            {/* 2. Duration */}
            <div className="space-y-3">
              <SectionHeader icon={CreditCard} title="مدة الاشتراك" />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">الدورة</Label>
                  <Select
                    value={interval}
                    onValueChange={(v) => { setIntervalVal(v); setDurationMonths(v === "MONTHLY" ? 1 : 12); }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANNUAL">سنوي</SelectItem>
                      <SelectItem value="MONTHLY">شهري</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">المدة (أشهر)</Label>
                  <Input
                    type="number" min="1" value={durationMonths}
                    onChange={(e) => setDurationMonths(Number(e.target.value))} dir="ltr"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* 3. Code validity */}
            <div className="space-y-3">
              <SectionHeader icon={Clock} title="صلاحية الكود (اختياري)" />
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">عدد الأيام — 0 يعني الكود دائم</Label>
                <Input
                  type="number" min="0" value={validDays}
                  onChange={(e) => setValidDays(Number(e.target.value))}
                  dir="ltr"
                  className="w-36"
                />
                {validDays > 0 && (
                  <p className="text-xs text-amber-600">الكود ينتهي بعد {validDays} يوم من تاريخ التوليد.</p>
                )}
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={generate} disabled={pending || selected.size === 0}>
                {pending && <Loader2 className="size-4 animate-spin" />}
                توليد الكود
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── CustomersTable ─── */
export function CustomersTable({ customers, moduleOptions }: { customers: CustomerRow[]; moduleOptions: ModuleOption[] }) {
  const [pending, start] = useTransition();
  const labelOf = (k: string) => moduleOptions.find((m) => m.key === k)?.label ?? k;
  const cancel = (c: CustomerRow) => {
    if (!window.confirm(`إلغاء اشتراك «${c.name}»؟`)) return;
    start(async () => {
      const r = await cancelOrgSubscriptionAction(c.id);
      if (r.ok) toast.success("تم الإلغاء"); else toast.error(r.error ?? "تعذّر الإلغاء");
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>العملاء والاشتراكات</CardTitle>
        <CardDescription>الموديولات المتاحة وحالة الاشتراك لكل عميل.</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {customers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">لا عملاء بعد.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b [&>th]:p-2 [&>th]:text-start">
                <th>العميل</th><th>الحالة</th><th>الدورة</th><th>السعر</th><th>الموديولات</th><th>الانتهاء</th><th></th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => {
                const st = SUB_STATUS[c.status] ?? SUB_STATUS.NONE;
                return (
                  <tr key={c.id} className="border-b last:border-0 [&>td]:p-2 [&>td]:align-middle">
                    <td>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{c.name}</span>
                        <Link href={`/platform/customers/${c.id}`} className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="size-3" />
                        </Link>
                      </div>
                      {c.email && <div className="text-xs text-muted-foreground" dir="ltr">{c.email}</div>}
                    </td>
                    <td>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.interval === "MONTHLY" ? "شهري" : c.interval === "ANNUAL" ? "سنوي" : "—"}
                    </td>
                    <td className="text-xs tabular-nums">{c.price > 0 ? money(c.price) : "—"}</td>
                    <td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.modules.length
                          ? c.modules.map((m) => <Badge key={m} variant="secondary" className="text-[10px]">{labelOf(m)}</Badge>)
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    <td className="text-xs tabular-nums">
                      {fmtDate(c.expiresAt)}
                      {c.daysLeft != null && c.live && c.daysLeft <= 30 && (
                        <span className="ms-1 text-amber-600">({c.daysLeft}ي)</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        <ManageDialog customer={c} moduleOptions={moduleOptions} />
                        {c.status !== "CANCELLED" && c.status !== "NONE" && (
                          <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => cancel(c)}>
                            <Ban className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── CodesManager ─── */
export function CodesManager({ codes, moduleOptions }: { codes: CodeRow[]; moduleOptions: ModuleOption[] }) {
  const [pending, start] = useTransition();
  const labelOf = (k: string) => moduleOptions.find((m) => m.key === k)?.label ?? k;
  const revoke = (id: string) => {
    if (!window.confirm("إلغاء هذا الكود؟")) return;
    start(async () => {
      const r = await revokeActivationCodeAction(id);
      if (r.ok) toast.success("تم إلغاء الكود"); else toast.error(r.error ?? "تعذّر الإلغاء");
    });
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <CardTitle>أكواد التفعيل</CardTitle>
          <CardDescription>مشفّرة ومخزّنة كبصمة فقط — تُعرض مرة واحدة عند التوليد.</CardDescription>
        </div>
        <GenerateDialog moduleOptions={moduleOptions} />
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {codes.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">لا أكواد بعد.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b [&>th]:p-2 [&>th]:text-start">
                <th>الكود</th><th>الحالة</th><th>الدورة / المدة</th><th>السعر</th><th>الموديولات</th><th>العميل</th><th>ينتهي</th><th>تاريخ الإصدار</th><th></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const st = CODE_STATUS[c.status] ?? CODE_STATUS.UNUSED;
                return (
                  <tr key={c.id} className="border-b last:border-0 [&>td]:p-2 [&>td]:align-middle">
                    <td className="font-mono text-xs" dir="ltr">{c.hint}</td>
                    <td>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", st.cls)}>{st.label}</span>
                    </td>
                    <td className="text-xs text-muted-foreground">
                      {c.interval === "MONTHLY" ? "شهري" : "سنوي"} · {c.durationMonths} شهر
                    </td>
                    <td className="text-xs tabular-nums">{c.price > 0 ? money(c.price) : "—"}</td>
                    <td>
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {c.modules.map((m) => (
                          <Badge key={m} variant="secondary" className="text-[10px]">{labelOf(m)}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="text-xs">{c.orgName ?? "—"}</td>
                    <td className="text-xs tabular-nums">
                      {c.expiresAt ? (
                        <span className={cn(
                          new Date(c.expiresAt) < new Date(Date.now() + 7 * 86_400_000)
                            ? "text-red-600"
                            : "text-muted-foreground",
                        )}>
                          {fmtDate(c.expiresAt)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">دائم</span>
                      )}
                    </td>
                    <td className="text-xs tabular-nums text-muted-foreground">{fmtDate(c.createdAt)}</td>
                    <td className="text-end">
                      {c.status === "UNUSED" && (
                        <Button variant="ghost" size="sm" className="text-destructive" disabled={pending} onClick={() => revoke(c.id)}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

/* ─── Combined (backward compat) ─── */
export function LicensingManager({ customers, codes, moduleOptions }: {
  customers: CustomerRow[];
  codes: CodeRow[];
  moduleOptions: ModuleOption[];
}) {
  return (
    <div className="space-y-6">
      <CustomersTable customers={customers} moduleOptions={moduleOptions} />
      <CodesManager codes={codes} moduleOptions={moduleOptions} />
    </div>
  );
}
