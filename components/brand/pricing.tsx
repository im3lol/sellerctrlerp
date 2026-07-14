"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users, HardDrive, Check } from "lucide-react";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type PlanCard = { name: string; priceMonthly: number; priceAnnual: number; maxUsers: number | null; storageGb: number | null; modules: string[] };

const egp = (n: number) => n.toLocaleString("ar-EG");
// Effective monthly price and % saved when paying annually.
const effMonthly = (p: PlanCard, annual: boolean) => (annual ? Math.round(p.priceAnnual / 12) : p.priceMonthly);
const discountPct = (p: PlanCard) => (p.priceMonthly > 0 ? Math.round((1 - p.priceAnnual / (p.priceMonthly * 12)) * 100) : 0);

export function Pricing({ plans }: { plans: PlanCard[] }) {
  const [annual, setAnnual] = useState(false);
  if (plans.length === 0) {
    return (
      <div className="mt-10 rounded-3xl border bg-card p-10 text-center">
        <p className="text-lg font-semibold">خطط مرنة تناسب كل حجم</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">ابدأ تجربتك المجانية الآن، وتواصل معنا لاختيار الباقة المناسبة لعدد مستخدميك.</p>
        <Button asChild className="mt-6"><Link href="/signup">ابدأ التجربة المجانية <ArrowLeft className="size-4" /></Link></Button>
      </div>
    );
  }
  const topPct = Math.max(...plans.map(discountPct));
  const popular = plans.length >= 3 ? Math.floor(plans.length / 2) : -1;

  return (
    <>
      {/* Monthly / annual toggle */}
      <div className="mt-8 flex justify-center">
        <div className="inline-flex items-center rounded-full border bg-card p-1 text-sm">
          <button type="button" onClick={() => setAnnual(false)} className={cn("rounded-full px-5 py-1.5 font-medium transition", !annual && "bg-primary text-primary-foreground")}>شهري</button>
          <button type="button" onClick={() => setAnnual(true)} className={cn("flex items-center gap-1.5 rounded-full px-5 py-1.5 font-medium transition", annual && "bg-primary text-primary-foreground")}>
            سنوي
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", annual ? "bg-primary-foreground/20 text-primary-foreground" : "bg-emerald-500/15 text-emerald-600")}>وفّر حتى {topPct}%</span>
          </button>
        </div>
      </div>

      <div className={cn("mt-10 grid gap-6", plans.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 max-w-3xl mx-auto")}>
        {plans.map((p, i) => {
          const eff = effMonthly(p, annual);
          const pct = discountPct(p);
          return (
            <div key={p.name} className={cn("relative flex flex-col rounded-2xl border bg-card p-6", i === popular && "border-primary shadow-lg ring-1 ring-primary")}>
              {i === popular && <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">الأكثر شيوعاً</span>}
              <h3 className="text-lg font-bold">{p.name}</h3>
              <div className="mt-3 flex items-end gap-1">
                <span className="text-3xl font-black tabular-nums">{eff > 0 ? egp(eff) : "مجاناً"}</span>
                {eff > 0 && <span className="pb-1 text-sm text-muted-foreground">ج.م / شهر</span>}
              </div>
              {p.priceMonthly > 0 && (
                annual
                  ? <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <s className="text-muted-foreground tabular-nums">{egp(p.priceMonthly)}</s>
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-600">وفّر {pct}%</span>
                      <span className="text-muted-foreground">يُدفع {egp(p.priceAnnual)} سنوياً</span>
                    </div>
                  : <div className="mt-1.5 text-xs text-muted-foreground">أو {egp(p.priceAnnual)} ج.م سنوياً — وفّر {pct}%</div>
              )}
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                <li className="flex items-center gap-2"><Users className="size-4 text-primary" />حتى {p.maxUsers == null ? "عدد غير محدود من المستخدمين" : `${egp(p.maxUsers)} مستخدم`}</li>
                <li className="flex items-center gap-2"><HardDrive className="size-4 text-primary" />تخزين {p.storageGb == null ? "غير محدود" : `${egp(p.storageGb)} جيجابايت`}</li>
                {p.modules.map((m) => (
                  <li key={m} className="flex items-center gap-2"><Check className="size-4 text-primary" />{MODULE_LABELS[m] ?? m}</li>
                ))}
              </ul>
              <Button asChild variant={i === popular ? "default" : "outline"} className="mt-6 w-full"><Link href={`/signup?plan=${encodeURIComponent(p.name)}&interval=${annual ? "ANNUAL" : "MONTHLY"}`}>ابدأ التجربة</Link></Button>
            </div>
          );
        })}
      </div>
    </>
  );
}
