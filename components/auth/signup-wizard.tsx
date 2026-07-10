"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Check, ArrowLeft, ArrowRight } from "lucide-react";
import { signupAction } from "@/app/(auth)/signup/actions";
import { ALL_MODULES, MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type PlanCard = { name: string; priceMonthly: number; priceAnnual: number; maxUsers: number | null; storageGb: number | null; modules: string[] };

const egp = (n: number) => n.toLocaleString("ar-EG");
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

  const submit = () => start(async () => {
    const r = await signupAction({ companyName, personName, email, phone, address, taxNumber, password, modules });
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
            <h1 className="text-xl font-bold">جاهز للانطلاق</h1>
            <p className="text-sm text-muted-foreground">ابدأ تجربتك المجانية الآن — واختر باقتك في أي وقت من الإعدادات.</p>
          </div>
          {plans.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-3">
              {plans.map((p) => (
                <div key={p.name} className="rounded-xl border bg-card p-4 text-center">
                  <div className="font-bold">{p.name}</div>
                  <div className="mt-1 text-lg font-black tabular-nums">{p.priceMonthly > 0 ? `${egp(p.priceMonthly)} ج.م` : "مجاناً"}</div>
                  <div className="text-[11px] text-muted-foreground">{p.priceMonthly > 0 ? "/ شهر" : ""}</div>
                  <div className="mt-2 text-[11px] text-muted-foreground">{p.maxUsers == null ? "مستخدمون بلا حد" : `${egp(p.maxUsers)} مستخدم`} · {p.storageGb == null ? "تخزين بلا حد" : `${egp(p.storageGb)} ج.ب`}</div>
                </div>
              ))}
            </div>
          )}
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-center text-sm">
            تبدأ بـ <b>تجربة مجانية ١٤ يوماً</b> بكل الوحدات المختارة. لن تُطالب بأي دفع الآن.
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mt-8 flex items-center justify-between gap-3">
        <Button variant="ghost" disabled={step === 0 || pending} onClick={() => setStep((s) => Math.max(0, s - 1))}>
          <ArrowRight className="size-4" /> رجوع
        </Button>
        {step < 2 ? (
          <Button onClick={next} disabled={pending}>التالي <ArrowLeft className="size-4" /></Button>
        ) : (
          <Button onClick={submit} disabled={pending} className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">
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
