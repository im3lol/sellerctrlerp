"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Check, ArrowLeft, ArrowRight, Copy } from "lucide-react";
import { signupAction } from "@/app/(auth)/signup/actions";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { PAYMENT_METHODS, WALLET_NUMBER } from "@/lib/erp/payment-info";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type PlanCard = { id: string; name: string; priceMonthly: number; priceAnnual: number; maxUsers: number | null; storageGb: number | null; modules: string[] };

const egp = (n: number) => n.toLocaleString("ar-EG");
const selectCls = "flex h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm";
const STEPS = ["بيانات الشركة", "الوحدات", "الباقة والتجربة"];

export function SignupWizard({ plans }: { plans: PlanCard[] }) {
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();

  const [companyName, setCompanyName] = useState("");
  const [personName, setPersonName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [modules, setModules] = useState<string[]>([...ALL_MODULES]);

  // Step 3: pick a plan to subscribe now (with payment), or leave null for trial-only.
  const [planId, setPlanId] = useState<string | null>(null);
  const [interval, setInterval] = useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [payMethod, setPayMethod] = useState<string>(PAYMENT_METHODS.find((m) => m.enabled)!.key);
  const [payReference, setPayReference] = useState("");
  const selectedPlan = plans.find((p) => p.id === planId) ?? null;
  const chosenMethod = PAYMENT_METHODS.find((m) => m.key === payMethod)!;
  const planPrice = selectedPlan ? (interval === "ANNUAL" ? selectedPlan.priceAnnual : selectedPlan.priceMonthly) : 0;

  const toggle = (m: string) => setModules((s) => (s.includes(m) ? s.filter((x) => x !== m) : [...s, m]));

  const step1Valid = companyName.trim().length >= 2 && personName.trim().length >= 2 && /.+@.+\..+/.test(email) && password.length >= 8 && password === confirm;

  const next = () => {
    if (step === 0 && !step1Valid) {
      if (password !== confirm) return toast.error("كلمتا المرور غير متطابقتين");
      if (password.length < 8) return toast.error("كلمة المرور 8 أحرف على الأقل");
      return toast.error("أكمل بيانات الشركة والمسؤول");
    }
    setStep((s) => Math.min(2, s + 1));
  };

  const submit = (withSubscription: boolean) => start(async () => {
    const subscribe = withSubscription && selectedPlan
      ? { planId: selectedPlan.id, interval, paymentMethod: payMethod, paymentReference: payReference }
      : null;
    const r = await signupAction({ companyName, personName, email, phone, address, taxNumber, password, modules, subscribe });
    // Success redirects; only errors return here.
    if (r?.error) toast.error(r.error);
  });

  return (
    <div className="w-full">
      {/* Stepper */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div className={cn("grid size-8 place-items-center rounded-full text-sm font-bold transition-colors", i < step ? "bg-primary text-primary-foreground" : i === step ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : "bg-muted text-muted-foreground")}>
              {i < step ? <Check className="size-4" /> : i + 1}
            </div>
            <span className={cn("hidden text-sm sm:block", i === step ? "font-semibold" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-bold">أنشئ حساب شركتك</h1>
            <p className="text-sm text-muted-foreground">ابدأ تجربتك المجانية ١٤ يوماً — بدون بطاقة ائتمان.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label>اسم الشركة *</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="شركتك" /></div>
            <div className="space-y-1.5"><Label>اسم المسؤول *</Label><Input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="الاسم الكامل" /></div>
            <div className="space-y-1.5"><Label>البريد الإلكتروني *</Label><Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></div>
            <div className="space-y-1.5"><Label>رقم الهاتف</Label><Input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx" /></div>
            <div className="space-y-1.5"><Label>الرقم الضريبي</Label><Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder="اختياري" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>العنوان</Label><Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="اختياري" /></div>
            <div className="space-y-1.5"><Label>كلمة المرور *</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="٨ أحرف على الأقل" /></div>
            <div className="space-y-1.5"><Label>تأكيد كلمة المرور *</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-bold">اختر الوحدات المطلوبة</h1>
            <p className="text-sm text-muted-foreground">فعّل ما تحتاجه — يمكنك تغييرها لاحقاً. كلها متاحة خلال التجربة.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {ALL_MODULES.map((m) => {
              const on = modules.includes(m);
              return (
                <button type="button" key={m} onClick={() => toggle(m)} className={cn("flex items-center justify-between rounded-xl border p-3 text-start transition-colors", on ? "border-primary bg-primary/5" : "hover:bg-accent")}>
                  <span className="text-sm font-medium">{MODULE_LABELS[m] ?? m}</span>
                  <span className={cn("grid size-5 place-items-center rounded-full border", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30")}>{on && <Check className="size-3" />}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center">
            <h1 className="text-xl font-bold">اختر باقتك أو ابدأ بالتجربة</h1>
            <p className="text-sm text-muted-foreground">اشترك الآن في باقة، أو ابدأ بتجربة مجانية ١٤ يوماً وقرّر لاحقاً.</p>
          </div>

          {plans.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {plans.map((p) => {
                const on = p.id === planId;
                return (
                  <button type="button" key={p.id} onClick={() => setPlanId(on ? null : p.id)}
                    className={cn("rounded-xl border bg-card p-4 text-center transition-colors", on ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50")}>
                    <div className="font-bold">{p.name}</div>
                    <div className="mt-1 text-lg font-black tabular-nums">{p.priceMonthly > 0 ? `${egp(p.priceMonthly)} ج.م` : "مجاناً"}</div>
                    <div className="text-[11px] text-muted-foreground">{p.priceMonthly > 0 ? "/ شهر" : ""}</div>
                    <div className="mt-2 text-[11px] text-muted-foreground">{p.maxUsers == null ? "مستخدمون بلا حد" : `${egp(p.maxUsers)} مستخدم`} · {p.storageGb == null ? "تخزين بلا حد" : `${egp(p.storageGb)} جيجا تخزين`}</div>
                    {on && <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="size-3" />مختارة</div>}
                  </button>
                );
              })}
            </div>
          )}

          {selectedPlan ? (
            <div className="space-y-3 rounded-xl border p-4">
              <div className="flex items-center justify-between">
                <span className="font-semibold">الاشتراك في باقة {selectedPlan.name}</span>
                <button type="button" onClick={() => setPlanId(null)} className="text-xs text-muted-foreground hover:underline">أو ابدأ بتجربة مجانية</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>الدورة</Label>
                  <select className={selectCls} value={interval} onChange={(e) => setInterval(e.target.value as "MONTHLY" | "ANNUAL")}>
                    <option value="MONTHLY">شهري — {egp(selectedPlan.priceMonthly)} ج.م</option>
                    <option value="ANNUAL">سنوي — {egp(selectedPlan.priceAnnual)} ج.م</option>
                  </select>
                </div>
                <div className="space-y-1.5"><Label>طريقة الدفع</Label>
                  <select className={selectCls} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                    {PAYMENT_METHODS.filter((m) => m.enabled).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="mb-1 font-medium">المبلغ: {egp(planPrice)} ج.م</div>
                <p className="text-muted-foreground">{chosenMethod.detail}</p>
                {payMethod === "INSTAPAY" && (
                  <button type="button" onClick={() => { navigator.clipboard?.writeText(WALLET_NUMBER); toast.success("تم نسخ الرقم"); }}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border bg-card px-3 py-1.5 font-mono text-base font-semibold hover:bg-accent" dir="ltr">
                    {WALLET_NUMBER}<Copy className="size-3.5" />
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>رقم/مرجع عملية الدفع <span className="text-muted-foreground">(اختياري)</span></Label>
                <Input value={payReference} onChange={(e) => setPayReference(e.target.value)} placeholder="رقم التحويل من إنستا باي أو البنك" />
              </div>
              <p className="text-xs text-muted-foreground">تبدأ التجربة فوراً، ويُفعّل اشتراكك بعد مراجعة الدفع.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm">
              تبدأ بـ <b>تجربة مجانية ١٤ يوماً</b> بكل الوحدات المختارة. لن تُطالب بأي دفع الآن.
            </div>
          )}
        </div>
      )}

      {/* Controls */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" disabled={step === 0 || pending} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          <ArrowRight className="size-4" /> رجوع
        </Button>
        {step < 2 ? (
          <Button onClick={next} disabled={pending}>التالي <ArrowLeft className="size-4" /></Button>
        ) : selectedPlan ? (
          <Button onClick={() => submit(true)} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}اشترك الآن — {egp(planPrice)} ج.م
          </Button>
        ) : (
          <Button onClick={() => submit(false)} disabled={pending} className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">
            {pending && <Loader2 className="size-4 animate-spin" />}ابدأ التجربة المجانية
          </Button>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        لديك حساب بالفعل؟ <Link href="/login" className="font-medium text-primary hover:underline">تسجيل الدخول</Link>
      </p>
    </div>
  );
}
