"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X, ArrowLeft, ArrowRight, LayoutDashboard, Boxes, Store, CreditCard, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const SEEN_KEY = "sc_tour_seen";

const STEPS = [
  { icon: Rocket, title: "أهلاً بك في SellerCtrl", body: "نظام واحد يدير محاسبتك ومخزونك ومبيعاتك ومشترياتك ومنصات بيعك. خلّينا نوريك أهم الأماكن في دقيقة." },
  { icon: LayoutDashboard, title: "لوحة التحكم", body: "أول ما تدخل، بتلاقي مؤشرات تجارتك: صافي الربح، النقدية، الذمم، وقيمة المخزون — وتنبيهات بأهم ما يحتاج انتباهك." },
  { icon: Boxes, title: "الوحدات متّصلة", body: "من القائمة الجانبية تتنقّل بين المحاسبة والمخزون والمبيعات والمشتريات. كل فاتورة وحركة تترحّل لحساباتك تلقائياً — مصدر واحد للحقيقة." },
  { icon: Store, title: "منصات البيع", body: "اربط أمازون ونون واستورد الطلبات والتسويات والمرتجعات؛ وكل عملية تنعكس على مخزونك وحساباتك." },
  { icon: CreditCard, title: "تجربتك المجانية", body: "أنت في تجربة مجانية ١٤ يوماً بكل الوحدات. تقدر تختار باقتك في أي وقت من الإعدادات ← الاشتراك والباقة." },
] as const;

export function OnboardingTour() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-open once for a first-time user; the button reopens it anytime after.
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem(SEEN_KEY)) {
      const t = setTimeout(() => setOpen(true), 800);
      return () => clearTimeout(t);
    }
  }, []);

  const markSeen = () => { try { localStorage.setItem(SEEN_KEY, "1"); } catch {} };
  const close = () => { setOpen(false); markSeen(); };
  const start = () => { setStep(0); setOpen(true); };

  const S = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <>
      {/* Floating launcher — bottom-left, on-brand */}
      <button
        type="button"
        onClick={start}
        aria-label="جولة تعريفية"
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
      >
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">جولة تعريفية</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div dir="rtl" className="relative w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {/* Brand header */}
            <div className="flex items-center justify-between bg-primary px-6 py-4 text-primary-foreground">
              <span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> جولة تعريفية</span>
              <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1 hover:bg-white/10"><X className="size-4" /></button>
            </div>

            <div className="p-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><S.icon className="size-7" /></div>
              <h2 className="mt-4 text-lg font-bold">{S.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{S.body}</p>

              {/* Progress dots */}
              <div className="mt-5 flex justify-center gap-1.5">
                {STEPS.map((_, i) => (
                  <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted")} />
                ))}
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button type="button" onClick={close} className="text-sm text-muted-foreground hover:text-foreground">تخطّي</button>
              <div className="flex items-center gap-2">
                {step > 0 && <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}><ArrowRight className="size-4" /> السابق</Button>}
                {!isLast ? (
                  <Button size="sm" onClick={() => setStep((s) => s + 1)}>التالي <ArrowLeft className="size-4" /></Button>
                ) : (
                  <Button asChild size="sm" className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90" onClick={close}>
                    <Link href="/erp/settings/subscription"><Rocket className="size-4" /> يلا نبدأ</Link>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
