"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sparkles, X, ArrowLeft, ArrowRight, EyeOff } from "lucide-react";
import { Icon } from "@/components/icon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { dismissTourAction } from "@/app/actions/erp/onboarding";

/**
 * Guided SPOTLIGHT tour: each step can anchor to a real element (`target` =
 * a [data-tour] value — every sidebar link carries data-tour={href}) and can
 * NAVIGATE to its page (`href`). Steps without a target (or whose element is
 * not on screen) fall back to a centered card, so nothing ever breaks.
 */
type Step = { icon: string; title: string; body: string; target?: string; href?: string };

const TOURS: Record<string, Step[]> = {
  home: [
    { icon: "Rocket", title: "أهلاً بك في SellerCtrl", body: "نظام واحد يدير محاسبتك ومخزونك ومبيعاتك ومشترياتك ومنصاتك. دي جولة سريعة على أهم الأماكن — ولكل قسم جولته الخاصة أول ما تدخله." },
    { icon: "LayoutDashboard", title: "وحدات النظام", body: "من هنا تدخل لأي وحدة: المحاسبة، المبيعات، المشتريات، المخزون… كل عملية فيها تترحّل لحساباتك تلقائيًا.", target: "dashboard-tiles" },
    { icon: "Search", title: "البحث السريع", body: "ابحث عن أي مستند أو صنف أو عميل من أي مكان في النظام.", target: "topbar-search" },
    { icon: "Bell", title: "الإشعارات", body: "الجرس بيجمع كل اللي محتاج انتباهك: مسودات، مخزون منخفض، طلبات أمازون الجديدة، وأذون بانتظار المخزون.", target: "notification-bell" },
    { icon: "Building2", title: "مؤسستك", body: "لو عندك أكثر من شركة، بدّل بينها من هنا — كل شركة ببياناتها المعزولة تمامًا.", target: "org-switcher" },
    { icon: "Rocket", title: "أكمل إعداد حسابك", body: "الكرت ده بيتابع خطوات تجهيز حسابك (أصناف، عملاء، أرصدة…) — بيختفي لوحده أول ما تكمّل.", target: "setup-card" },
    { icon: "CreditCard", title: "جاهز؟", body: "أنت في تجربة مجانية ١٤ يومًا بكل الوحدات. ادخل أي قسم من القائمة الجانبية وهتلاقي جولة قصيرة مستنياك." },
  ],
  sales: [
    { icon: "ShoppingCart", title: "جولة المبيعات", body: "هنمشي على دورة البيع كاملة صفحة بصفحة: عميل ← أمر بيع ← إذن صرف ← فاتورة ← سند قبض. اضغط «التالي» وهننتقل سوا." },
    { icon: "Users", title: "١) العملاء", body: "نقطة البداية: أضف عملاءك من «عميل جديد». منصات البيع (أمازون) بتنشئ عميلها تلقائيًا.", target: "/sales/customers", href: "/sales/customers" },
    { icon: "ClipboardList", title: "٢) أوامر البيع", body: "أنشئ أمرًا بالأصناف والكميات والأسعار، احفظه مسودة ثم أكّده — التأكيد بيحجز المخزون.", target: "/sales/orders", href: "/sales/orders" },
    { icon: "Truck", title: "٣) إذون الصرف", body: "سلّم البضاعة بإذن صرف — بيخصم من المخزون ويسجّل تكلفة البضاعة تلقائيًا.", target: "/sales/deliveries", href: "/sales/deliveries" },
    { icon: "ReceiptText", title: "٤) الفواتير", body: "أصدر الفاتورة من إذن الصرف بضغطة — إيراد وذمّة مدينة تترحّل تلقائيًا.", target: "/sales/invoices", href: "/sales/invoices" },
    { icon: "HandCoins", title: "٥) سندات القبض", body: "عند التحصيل سجّل سند قبض يقفل ذمّة العميل ويزيد النقدية. وكده الدورة اكتملت! 🎉", target: "/sales/receipts", href: "/sales/receipts" },
  ],
  purchases: [
    { icon: "Truck", title: "جولة المشتريات", body: "دورة الشراء كاملة صفحة بصفحة: مورّد ← أمر شراء ← إذن استلام ← فاتورة ← سند صرف. اضغط «التالي»." },
    { icon: "Users", title: "١) الموردون", body: "أضف مورّديك — المورّد هو نقطة بداية أي عملية شراء.", target: "/purchases/suppliers", href: "/purchases/suppliers" },
    { icon: "ClipboardList", title: "٢) أوامر الشراء", body: "أنشئ أمر شراء بالأصناف والتكاليف (مع الشحن لو موجود)، ثم أكّده.", target: "/purchases/orders", href: "/purchases/orders" },
    { icon: "PackageCheck", title: "٣) إذون الاستلام", body: "عند وصول البضاعة أكّد الاستلام — المخزون بيدخل فعليًا بتكلفته هنا.", target: "/purchases/receipts", href: "/purchases/receipts" },
    { icon: "ReceiptText", title: "٤) فواتير الشراء", body: "سجّل فاتورة المورّد — بتقفل «بضاعة لم تُفوتر» وتنشئ الذمّة الدائنة.", target: "/purchases/invoices", href: "/purchases/invoices" },
    { icon: "Banknote", title: "٥) سندات الصرف", body: "عند الدفع أنشئ سند صرف يقفل ذمّة المورّد ويحدّث النقدية/البنك. اكتملت الدورة! 🎉", target: "/purchases/payments", href: "/purchases/payments" },
  ],
  inventory: [
    { icon: "Warehouse", title: "جولة المخزون", body: "أصنافك وأرصدتك وحركتها — هنمر على أهم الشاشات صفحة بصفحة." },
    { icon: "Package", title: "١) الأصناف", body: "أضف منتجاتك من «صنف جديد»، أو استوردها ملفًا، أو زامنها من أمازون مباشرة.", target: "/inventory/items", href: "/inventory/items" },
    { icon: "Boxes", title: "٢) الأرصدة", body: "رصيد كل صنف في كل مخزن لحظيًا: الكمية والتكلفة المتوسطة والقيمة.", target: "/inventory/stock", href: "/inventory/stock" },
    { icon: "ClipboardCheck", title: "٣) التسويات (الجرد)", body: "اجرد فعليًا وأدخل الكميات — النظام يحسب الفرق وينشئ التسوية محاسبيًا.", target: "/inventory/adjustments", href: "/inventory/adjustments" },
    { icon: "ArrowLeftRight", title: "٤) التحويلات", body: "انقل مخزونًا بين مخازنك بإذن تحويل بيحافظ على التكلفة.", target: "/inventory/transfers", href: "/inventory/transfers" },
    { icon: "TriangleAlert", title: "٥) تنبيهات إعادة الطلب", body: "حدّد حدًا أدنى لكل صنف — والنظام ينبّهك قبل النفاد. ومعها تنبيهات الصلاحية والركود.", target: "/inventory/reorder", href: "/inventory/reorder" },
  ],
  accounting: [
    { icon: "Calculator", title: "جولة المحاسبة", body: "قيد مزدوج تلقائي خلف كل مستند — وهنا أدوات المحاسب الكاملة. هنمر عليها صفحة بصفحة." },
    { icon: "Calculator", title: "١) دليل الحسابات", body: "دليلك القياسي جاهز من التسجيل — راجعه وأضف أو عدّل ليطابق نشاطك.", target: "/accounting/chart", href: "/accounting/chart" },
    { icon: "BookText", title: "٢) القيود اليومية", body: "كل مستند بينشئ قيده تلقائيًا، وتقدر تسجّل قيودًا يدوية متوازنة عند الحاجة.", target: "/accounting/journal", href: "/accounting/journal" },
    { icon: "BookOpen", title: "٣) دفتر الأستاذ", body: "حركة أي حساب بالتفصيل مع رصيده الجاري.", target: "/accounting/ledger", href: "/accounting/ledger" },
    { icon: "Landmark", title: "٤) البنوك والمطابقة", body: "أضف حساباتك البنكية وطابق كشوفها مع قيودك.", target: "/accounting/banks", href: "/accounting/banks" },
    { icon: "ChartPie", title: "التقارير جاهزة", body: "ميزان المراجعة وقائمة الدخل والميزانية والتدفقات النقدية — كلها لحظية من قسم «التقارير والتحليلات»." },
  ],
  platforms: [
    { icon: "Store", title: "جولة المنصات", body: "اربط أمازون (أو أضف أي منصة يدوية) ووحّد مبيعاتك ومدفوعاتك ومخزونك مع النظام." },
    { icon: "Plus", title: "١) أضف منصة", body: "«ربط آلي» لأمازون بيجهّز كل حاجة تلقائيًا: عميل + مخزن FBA + محفظة بنكية.", target: "new-platform" },
    { icon: "RefreshCw", title: "٢) المزامنة", body: "بعد الربط: «مزامنة الآن» تسحب الكتالوج، والمزامنة التلقائية تدخل الطلبات الجديدة أولًا بأول — بالمستوى اللي تختاره (مسودة فقط حتى الدورة الكاملة) من إعدادات المنصة." },
    { icon: "ClipboardCheck", title: "٣) تدقيق المخزون", body: "من صفحة المنصة شغّل «تدقيق المخزون» لمطابقة كميات FBA مع النظام — ولو فيه فروقات، زر واحد ينشئ لك مسودة تسوية." },
    { icon: "Banknote", title: "٤) التسويات والمرتجعات", body: "المدفوعات والرسوم والتحويلات البنكية تُسحب تلقائيًا وتنتظر مراجعتك — والمرتجع بيعمل دورته العكسية كاملة." },
  ],
  hr: [
    { icon: "UsersRound", title: "جولة الموارد البشرية", body: "موظفوك وإجازاتهم ومسير رواتبك." },
    { icon: "UserCog", title: "١) الموظفون", body: "أضف موظفيك ورواتبهم وبياناتهم.", target: "/hr/employees", href: "/hr/employees" },
    { icon: "Banknote", title: "٢) مسير الرواتب", body: "أنشئ مسير الشهر — يحسب الاستحقاقات والخصومات ويترحّل محاسبيًا.", target: "/hr/payroll", href: "/hr/payroll" },
  ],
  investors: [
    { icon: "Coins", title: "جولة المستثمرين", body: "تابع المستثمرين وحصصهم ومساهماتهم وأرباحهم." },
    { icon: "Coins", title: "المستثمرون وحصصهم", body: "أضف كل مستثمر ونسبة حصته ومساهماته المالية — وتقارير حصص الأرباح جاهزة." },
  ],
  reports: [
    { icon: "ChartColumn", title: "جولة التقارير", body: "كل تقاريرك المالية لحظية — هنمر على أهم ثلاثة." },
    { icon: "TrendingUp", title: "قائمة الدخل", body: "أرباحك وخسائرك عن أي فترة — والفترة الافتراضية سنتك المالية.", target: "/reports/income-statement", href: "/reports/income-statement" },
    { icon: "Scale", title: "الميزانية العمومية", body: "أصولك والتزاماتك وحقوق الملكية في أي لحظة.", target: "/reports/balance-sheet", href: "/reports/balance-sheet" },
    { icon: "Percent", title: "ضريبة القيمة المضافة", body: "تقرير الضريبة (مخرجات − مدخلات) جاهز للمراجعة والتقديم.", target: "/reports/vat", href: "/reports/vat" },
  ],
};

/** Map the current path to a tour key (module), or null when none applies. */
function routeKey(path: string): string | null {
  if (path === "/dashboard") return "home";
  if (path.startsWith("/platforms")) return "platforms";
  if (path.startsWith("/purchases")) return "purchases";
  if (path.startsWith("/sales")) return "sales";
  if (path.startsWith("/inventory")) return "inventory";
  if (path.startsWith("/accounting")) return "accounting";
  if (path.startsWith("/hr")) return "hr";
  if (path.startsWith("/investors")) return "investors";
  if (path.startsWith("/reports")) return "reports";
  return null;
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;          // spotlight padding around the target
const POP_W = 340;      // popover width
const POP_H = 300;      // popover height estimate for flipping/clamping
const RESUME_KEY = "sc_tour_resume";

export function OnboardingTour({ dismissed = false }: { dismissed?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const key = routeKey(pathname);
  const steps = key ? TOURS[key] : null;

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Permanently off for this user (server-persisted, so it survives a localStorage
  // reset such as a changed tunnel origin). Once true, nothing renders.
  const [killed, setKilled] = useState(dismissed);

  // Resume a cross-page tour (stored just before router.push on «التالي»).
  useEffect(() => {
    if (!key || killed) return;
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (!raw) return;
      const r = JSON.parse(raw) as { key: string; idx: number };
      if (r.key === key) { sessionStorage.removeItem(RESUME_KEY); setStep(r.idx); setOpen(true); }
    } catch { /* ignore */ }
  }, [pathname, key, killed]);

  // Auto-open a module's tour the first time it's visited (tracked per module).
  useEffect(() => {
    if (!key || killed || typeof window === "undefined") return;
    if (localStorage.getItem(`sc_tour_${key}`)) return;
    if (sessionStorage.getItem(RESUME_KEY)) return; // a resume is about to take over
    const t = setTimeout(() => { setStep(0); setOpen(true); }, 700);
    return () => clearTimeout(t);
  }, [key, killed]);

  // Anchor: find the step's [data-tour] element, scroll it into view, track its rect.
  const S = steps?.[step];
  useEffect(() => {
    if (!open || !S?.target) { setRect(null); return; }
    const el = document.querySelector(`[data-tour="${S.target}"]`);
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) { setRect(null); return; }
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const t = setTimeout(measure, 400); // re-measure after the smooth scroll settles
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => { clearTimeout(t); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [open, step, S?.target, pathname]);

  if (!steps || killed) return null;

  const markSeen = () => { try { localStorage.setItem(`sc_tour_${key}`, "1"); } catch { /* ignore */ } };
  const close = () => { setOpen(false); markSeen(); try { sessionStorage.removeItem(RESUME_KEY); } catch { /* ignore */ } };
  const reopen = () => { setStep(0); setOpen(true); };
  // End it everywhere, for good.
  const killForever = () => { close(); setKilled(true); void dismissTourAction(); };

  const isLast = step === steps.length - 1;
  const goNext = () => {
    const nxt = steps[step + 1];
    if (nxt?.href && nxt.href !== pathname) {
      try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ key, idx: step + 1 })); } catch { /* ignore */ }
      router.push(nxt.href);
      return;
    }
    setStep((s) => s + 1);
  };
  const goPrev = () => {
    const prv = steps[step - 1];
    if (prv?.href && prv.href !== pathname) {
      try { sessionStorage.setItem(RESUME_KEY, JSON.stringify({ key, idx: step - 1 })); } catch { /* ignore */ }
      router.push(prv.href);
      return;
    }
    setStep((s) => s - 1);
  };

  // Popover placement next to the spotlight (below if it fits, else above), clamped
  // to the viewport. Centered fallback when the step has no on-screen target.
  const anchored = !!rect;
  const popStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        width: POP_W,
        left: Math.min(Math.max(8, rect.left + rect.width / 2 - POP_W / 2), (typeof window !== "undefined" ? window.innerWidth : 1200) - POP_W - 8),
        top: rect.top + rect.height + PAD + 12 + POP_H < (typeof window !== "undefined" ? window.innerHeight : 800)
          ? rect.top + rect.height + PAD + 12
          : Math.max(8, rect.top - PAD - 12 - POP_H),
      }
    : {};

  const card = S && (
    <div dir="rtl" className={cn("overflow-hidden rounded-2xl bg-card shadow-2xl", anchored ? "z-[51]" : "w-full max-w-md")} style={anchored ? { ...popStyle, zIndex: 51 } : undefined} onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between bg-primary px-5 py-3 text-primary-foreground">
        <span className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4" /> جولة تعريفية</span>
        <button type="button" onClick={close} aria-label="إغلاق" className="rounded-lg p-1 hover:bg-white/10"><X className="size-4" /></button>
      </div>

      <div className={cn("p-5", anchored ? "text-start" : "text-center")}>
        <div className={cn("grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary", anchored ? "" : "mx-auto")}><Icon name={S.icon} className="size-6" /></div>
        <h2 className="mt-3 text-base font-bold">{S.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{S.body}</p>

        <div className={cn("mt-4 flex gap-1.5", anchored ? "" : "justify-center")}>
          {steps.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full transition-all", i === step ? "w-5 bg-primary" : "w-1.5 bg-muted")} />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
        <button type="button" onClick={close} className="text-sm text-muted-foreground hover:text-foreground">تخطّي</button>
        <div className="flex items-center gap-2">
          {step > 0 && <Button variant="ghost" size="sm" onClick={goPrev}><ArrowRight className="size-4" /> السابق</Button>}
          {!isLast ? (
            <Button size="sm" onClick={goNext}>التالي <ArrowLeft className="size-4" /></Button>
          ) : (
            <Button size="sm" onClick={close} className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">تمام، فهمت</Button>
          )}
        </div>
      </div>

      {/* Prominent, obvious permanent-off — a customer must be able to find it. */}
      <button
        type="button"
        onClick={killForever}
        className="flex w-full items-center justify-center gap-2 border-t bg-muted/40 px-5 py-3 text-sm font-semibold text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <EyeOff className="size-4" /> عدم عرض الجولة التعريفية نهائياً
      </button>
    </div>
  );

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

      {open && S && (
        <>
          {/* Click-catcher (transparent — the dimming comes from the spotlight's shadow). */}
          <div className={cn("fixed inset-0 z-50", anchored ? "" : "bg-black/50")} onClick={close} />
          {/* Spotlight: a hole over the target, dimming everything else via a huge shadow. */}
          {rect && (
            <div
              className="pointer-events-none fixed z-50 rounded-xl transition-all duration-300"
              style={{
                top: rect.top - PAD,
                left: rect.left - PAD,
                width: rect.width + PAD * 2,
                height: rect.height + PAD * 2,
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              }}
            />
          )}
          {anchored ? card : (
            <div className="pointer-events-none fixed inset-0 z-[51] flex items-center justify-center p-4">
              <div className="pointer-events-auto w-full max-w-md">{card}</div>
            </div>
          )}
        </>
      )}
    </>
  );
}
