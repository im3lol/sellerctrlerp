"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sparkles, X, ArrowLeft, ArrowRight } from "lucide-react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Step = { icon: string; title: string; body: string };

// One guided walkthrough per module. The key matches the route prefix (see routeKey).
const TOURS: Record<string, Step[]> = {
  home: [
    { icon: "Rocket", title: "أهلاً بك في SellerCtrl", body: "نظام واحد يدير محاسبتك ومخزونك ومبيعاتك ومشترياتك ومنصاتك. لكل قسم جولة قصيرة تظهر أول ما تدخله." },
    { icon: "LayoutDashboard", title: "لوحة التحكم", body: "مؤشرات تجارتك: صافي الربح، النقدية، الذمم، وقيمة المخزون — مع تنبيهات بأهم ما يحتاج انتباهك." },
    { icon: "Boxes", title: "الوحدات متّصلة", body: "تنقّل من القائمة الجانبية بين المحاسبة والمخزون والمبيعات والمشتريات — وكل عملية تترحّل لحساباتك تلقائياً." },
    { icon: "Store", title: "منصات البيع", body: "اربط أمازون ونون واستورد الطلبات والتسويات والمرتجعات." },
    { icon: "CreditCard", title: "اشتراكك", body: "أنت في تجربة مجانية ١٤ يوماً بكل الوحدات. اختر باقتك من الإعدادات ← الاشتراك في أي وقت." },
  ],
  purchases: [
    { icon: "Truck", title: "جولة المشتريات", body: "دورة الشراء بالترتيب: مورّد ← أمر شراء ← إذن استلام ← فاتورة ← سند صرف." },
    { icon: "Users", title: "١) أضف مورّداً", body: "من صفحة «الموردون» اضغط «مورد جديد» وأدخل بياناته. المورّد هو نقطة بداية أي عملية شراء." },
    { icon: "ClipboardList", title: "٢) أمر شراء", body: "من «أوامر الشراء» أنشئ أمراً بالأصناف والكميات والأسعار، احفظه كمسودة ثم أكّده." },
    { icon: "PackageCheck", title: "٣) إذن استلام", body: "عند وصول البضاعة، حوّل الأمر إلى إذن استلام ليدخل المخزون فعلياً بالتكلفة." },
    { icon: "ReceiptText", title: "٤) فاتورة شراء", body: "سجّل فاتورة المورّد — تُنشئ ذمّة دائنة وتترحّل محاسبياً تلقائياً." },
    { icon: "Banknote", title: "٥) سند صرف", body: "عند الدفع أنشئ سند صرف يقفل الذمّة ويحدّث النقدية/البنك." },
  ],
  sales: [
    { icon: "ShoppingCart", title: "جولة المبيعات", body: "دورة البيع بالترتيب: عميل ← أمر بيع ← تسليم ← فاتورة ← سند قبض." },
    { icon: "Users", title: "١) أضف عميلاً", body: "من صفحة «العملاء» أضف عميلاً جديداً ببياناته." },
    { icon: "ClipboardList", title: "٢) أمر بيع", body: "أنشئ أمر بيع بالأصناف والأسعار للعميل، ثم أكّده." },
    { icon: "Truck", title: "٣) إذن صرف (تسليم)", body: "سلّم البضاعة عبر إذن صرف يخصم من المخزون." },
    { icon: "ReceiptText", title: "٤) فاتورة بيع", body: "أصدر الفاتورة — تُنشئ ذمّة مدينة وإيراداً وتترحّل تلقائياً." },
    { icon: "HandCoins", title: "٥) سند قبض", body: "عند التحصيل أنشئ سند قبض يقفل الذمّة ويزيد النقدية." },
  ],
  inventory: [
    { icon: "Warehouse", title: "جولة المخزون", body: "أصنافك وأرصدتك وحركتها في مكان واحد." },
    { icon: "Package", title: "١) الأصناف", body: "أضف أصنافك ووحداتها وأسعارها وتكاليفها من «الأصناف»." },
    { icon: "Boxes", title: "٢) الأرصدة", body: "تابع رصيد كل صنف في كل مستودع لحظياً." },
    { icon: "ClipboardCheck", title: "٣) التسويات", body: "صحّح فروقات الجرد الفعلي عبر «تسويات المخزون»." },
    { icon: "ArrowLeftRight", title: "٤) التحويلات", body: "انقل المخزون بين المستودعات بإذن تحويل." },
    { icon: "TriangleAlert", title: "٥) التنبيهات", body: "تنبيهات إعادة الطلب وقرب انتهاء الصلاحية تحميك من النواقص والتلف." },
  ],
  accounting: [
    { icon: "Calculator", title: "جولة المحاسبة", body: "قيد مزدوج تلقائي خلف كل مستند، مع أدوات يدوية عند الحاجة." },
    { icon: "Calculator", title: "١) دليل الحسابات", body: "ابدأ بدليل حسابات جاهز، وأضف أو عدّل حساباتك بسهولة." },
    { icon: "BookText", title: "٢) القيود اليومية", body: "سجّل قيوداً يدوية متوازنة عند الحاجة." },
    { icon: "BookOpen", title: "٣) دفتر الأستاذ", body: "راجع حركة أي حساب وتفاصيل أرصدته." },
    { icon: "Landmark", title: "٤) الحسابات البنكية", body: "أضف بنوكك وطابق كشوف حساباتها." },
    { icon: "ChartPie", title: "٥) التقارير", body: "ميزان المراجعة والدخل والميزانية جاهزة لحظياً." },
  ],
  platforms: [
    { icon: "Store", title: "جولة المنصات", body: "اربط أمازون ونون ووحّد مبيعاتك ومخزونك وحساباتك." },
    { icon: "Store", title: "١) أضف منصة", body: "أنشئ منصة (أمازون/نون) — تُنشأ لها عميل ومستودع وحساب بنكي تلقائياً." },
    { icon: "Upload", title: "٢) استيراد الطلبات", body: "استورد ملف الطلبات فيتحوّل لأوامر بيع بضغطة." },
    { icon: "Banknote", title: "٣) التسويات", body: "استورد تقرير التسوية (Settlement) ليطابق المدفوعات والرسوم." },
    { icon: "PackageX", title: "٤) المرتجعات", body: "استورد المرتجعات فترجع للمخزون وتُعالَج محاسبياً." },
  ],
  hr: [
    { icon: "UsersRound", title: "جولة الموارد البشرية", body: "موظفوك ومسير رواتبك في مكان واحد." },
    { icon: "UserCog", title: "١) الموظفون", body: "أضف موظفيك وبياناتهم من صفحة «الموظفون»." },
    { icon: "Banknote", title: "٢) مسير الرواتب", body: "أنشئ مسير رواتب الشهر — يترحّل محاسبياً تلقائياً." },
  ],
  investors: [
    { icon: "Coins", title: "جولة المستثمرين", body: "تابع المستثمرين وحصصهم وأرباحهم." },
    { icon: "Coins", title: "المستثمرون وحصصهم", body: "أضف كل مستثمر ونسبة حصته ومساهماته المالية." },
  ],
  reports: [
    { icon: "ChartColumn", title: "جولة التقارير", body: "كل تقاريرك المالية لحظية وجاهزة." },
    { icon: "TrendingUp", title: "قائمة الدخل", body: "أرباحك وخسائرك عن أي فترة تختارها." },
    { icon: "Scale", title: "الميزانية العمومية", body: "أصولك والتزاماتك وحقوق الملكية في لحظة." },
    { icon: "Percent", title: "ضريبة القيمة المضافة", body: "تقرير الضريبة جاهز للمراجعة والتقديم." },
  ],
};

/** Map the current path to a tour key (module), or null when none applies. */
function routeKey(path: string): string | null {
  if (path === "/dashboard") return "home";
  if (path.startsWith("/erp/platforms")) return "platforms";
  if (path.startsWith("/erp/purchases")) return "purchases";
  if (path.startsWith("/erp/sales")) return "sales";
  if (path.startsWith("/erp/inventory")) return "inventory";
  if (path.startsWith("/erp/accounting")) return "accounting";
  if (path.startsWith("/erp/hr")) return "hr";
  if (path.startsWith("/erp/investors")) return "investors";
  if (path.startsWith("/erp/reports")) return "reports";
  return null;
}

export function OnboardingTour() {
  const pathname = usePathname();
  const key = routeKey(pathname);
  const steps = key ? TOURS[key] : null;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  // Auto-open a module's tour the first time it's visited (tracked per module).
  useEffect(() => {
    if (!key || typeof window === "undefined") return;
    if (localStorage.getItem(`sc_tour_${key}`)) return;
    const t = setTimeout(() => { setStep(0); setOpen(true); }, 700);
    return () => clearTimeout(t);
  }, [key]);

  if (!steps) return null;

  const markSeen = () => { try { localStorage.setItem(`sc_tour_${key}`, "1"); } catch {} };
  const close = () => { setOpen(false); markSeen(); };
  const reopen = () => { setStep(0); setOpen(true); };

  const S = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <>
      {/* Floating launcher — bottom-left, reopens the current module's tour */}
      <button
        type="button"
        onClick={reopen}
        aria-label="جولة تعريفية"
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-105"
      >
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">جولة القسم</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
          <div dir="rtl" className="relative w-full max-w-md overflow-hidden rounded-2xl bg-card shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between bg-primary px-6 py-4 text-primary-foreground">
              <span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> جولة تعريفية</span>
              <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1 hover:bg-white/10"><X className="size-4" /></button>
            </div>

            <div className="p-6 text-center">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary"><Icon name={S.icon} className="size-7" /></div>
              <h2 className="mt-4 text-lg font-bold">{S.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{S.body}</p>

              <div className="mt-5 flex justify-center gap-1.5">
                {steps.map((_, i) => (
                  <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted")} />
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button type="button" onClick={close} className="text-sm text-muted-foreground hover:text-foreground">تخطّي</button>
              <div className="flex items-center gap-2">
                {step > 0 && <Button variant="ghost" size="sm" onClick={() => setStep((s) => s - 1)}><ArrowRight className="size-4" /> السابق</Button>}
                {!isLast ? (
                  <Button size="sm" onClick={() => setStep((s) => s + 1)}>التالي <ArrowLeft className="size-4" /></Button>
                ) : (
                  <Button size="sm" onClick={close} className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">تمام، فهمت</Button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
