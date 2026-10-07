import Link from "next/link";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { TRIAL_DAYS } from "@/lib/erp/trial";
import {
  Calculator,
  Boxes,
  ShoppingCart,
  ReceiptText,
  Store,
  LayoutDashboard,
  FileSpreadsheet,
  PackageX,
  Wallet,
  CalendarX,
  Languages,
  Link2,
  Building2,
  Zap,
  ShieldCheck,
  Truck,
  Search,
  ChartPie,
  Mail,
  MessageCircle,
  Check,
  UserCog,
  Warehouse,
  Coins,
  UsersRound,
  ChartColumn,
  Wrench,
  ChevronDown,
  Bell,
} from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { plans } from "@/db/schema";
import { Logo } from "@/components/brand/logo";
import { Pricing } from "@/components/brand/pricing";
import { SourceTracker } from "@/components/brand/source-tracker";
import { DemoRequestButton } from "@/components/brand/demo-request";
import { LocaleToggle } from "@/components/brand/locale-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Static marketing page; refresh plan pricing at most hourly (ISR) so the DB
// query doesn't run per request.
export const revalidate = 3600;

// Pain points the unified system removes.
const PAINS = [
  { icon: FileSpreadsheet, text: "إكسيل للمخزون، برنامج للمحاسبة، وشيت للطلبات — وكل شهر الأرقام مش بتتطابق." },
  { icon: PackageX, text: "مخزون موزّع على أكتر من مستودع ومنصة، ومحدش عارف الرصيد الحقيقي أو اللي قرب يخلص." },
  { icon: Wallet, text: "مفيش صورة واضحة للربح الحقيقي بعد الشحن والخصومات والضريبة والمرتجعات." },
  { icon: CalendarX, text: "آخر الشهر = كابوس تجميع أرقام يدوي وأخطاء بتكلّفك فلوس." },
];

// The six modules.
const MODULES = [
  { icon: Calculator, title: "محاسبة كاملة", desc: "قيد مزدوج حقيقي، دليل حسابات، قوائم مالية (دخل · ميزانية · ميزان مراجعة)، ومراكز تكلفة — بترحيل تلقائي من كل مستند." },
  { icon: Boxes, title: "مخزون دقيق", desc: "متعدد المستودعات، تكلفة بالدفعة (FIFO)، تتبّع الدفعات وتاريخ الصلاحية (FEFO)، تسويات وتحويلات، وتنبيهات النواقص والانتهاء." },
  { icon: ShoppingCart, title: "دورة شراء كاملة", desc: "أمر شراء ← إذن استلام ← فاتورة ← دفعة، مع المرتجعات وأعمار ذمم الموردين." },
  { icon: ReceiptText, title: "دورة بيع كاملة", desc: "أمر بيع ← تسليم ← فاتورة ← تحصيل، مع المرتجعات وأعمار ذمم العملاء." },
  { icon: Store, title: "تكامل أمازون", desc: "اربط حساب أمازون واستورد الطلبات والتسويات والمرتجعات والرسوم — وكل عملية تترحّل لمخزونك وحساباتك تلقائياً. (نون قريبًا)" },
  { icon: LayoutDashboard, title: "لوحة تحكم لحظية", desc: "الأرباح والنقدية والذمم وقيمة المخزون — صورة كاملة لتجارتك في شاشة واحدة." },
];

// Differentiators.
const WHY = [
  { icon: Languages, title: "عربي بالكامل", desc: "واجهة RTL، أرقام وتواريخ واضحة، ومصطلحات محاسبية صحيحة." },
  { icon: Link2, title: "متّصل فعلاً", desc: "مش أدوات ملزوقة — المخزون والمحاسبة والمبيعات كيان واحد." },
  { icon: Building2, title: "متعدد الشركات", desc: "أدِر أكتر من منشأة أو متجر من نفس الحساب." },
  { icon: ShieldCheck, title: "دقّة مضمونة", desc: "كل قيد متوازن، وقيمة المخزون تساوي الدفتر دائماً." },
  { icon: Zap, title: "سريع وجاهز", desc: "إعداد في دقائق بدون فريق تقني." },
];

const STEPS = [
  { n: "1", title: "سجّل وجهّز منشأتك", desc: "حساباتك ومستودعاتك وأصنافك جاهزة في دقائق." },
  { n: "2", title: "شغّل عملياتك", desc: "بيع، اشترِ، حرّك مخزون — وكل حركة تترحّل لحساباتك تلقائياً." },
  { n: "3", title: "قرّر بثقة", desc: "لوحة وتقارير لحظية توريك ربحك الحقيقي وصحّة تجارتك." },
];

const FAQS = [
  { q: "محتاج خبرة محاسبية لاستخدامه؟", a: "لأ — النظام بيرحّل القيود المحاسبية تلقائياً خلف الكواليس من كل فاتورة وحركة." },
  { q: "بيشتغل لأكتر من متجر أو شركة؟", a: "أيوه، النظام متعدد الشركات والمستودعات بالكامل، وكل منشأة معزولة عن غيرها." },
  { q: "بيدعم الدفعات وتاريخ الصلاحية؟", a: "أيوه، بتتبّع دقيق للدفعات ونظام صرف الأقدم انتهاءً أولاً (FEFO) وتنبيهات قرب الانتهاء." },
  { q: "بياناتي آمنة؟", a: "بيانات كل منشأة معزولة تماماً، والوصول محكوم بصلاحيات دقيقة لكل مستخدم." },
];

// Only real integrations. Amazon is live; Noon is on the roadmap (marked قريبًا).
const MARKETPLACES: { name: string; soon?: boolean }[] = [
  { name: "amazon" },
  { name: "noon", soon: true },
];

export default async function Home() {
  const t = await getT();
  // Degrade to the empty-state pricing card if the DB is unreachable at build/runtime.
  const catalog = await db.select().from(plans).where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly)).catch(() => []);
  const pricing = catalog.map((p) => ({
    name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    maxUsers: p.maxUsers, storageGb: p.storageGb, modules: p.enabledModules ?? [],
  }));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SourceTracker />
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Logo className="text-2xl text-primary" />
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#modules" className="hover:text-foreground">{t("الموديولات")}</a>
            <a href="#why" className="hover:text-foreground">{t("لماذا نحن")}</a>
            <a href="#pricing" className="hover:text-foreground">{t("الأسعار")}</a>
            <a href="#how" className="hover:text-foreground">{t("كيف يعمل")}</a>
            <a href="#faq" className="hover:text-foreground">{t("الأسئلة")}</a>
          </nav>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <Button variant="ghost" asChild>
              <Link href="/login">{t("دخول العملاء")}</Link>
            </Button>
            <Button asChild className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">
              <Link href="/signup">{t("ابدأ مجاناً")}</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center md:py-24 md:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            {t("نظام ERP عربي متكامل للبائعين")}
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">
            {t("نظام واحد يدير تجارتك")}
            <span className="text-primary"> {t("بالكامل")}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            {t("منصة متكاملة تجمع المحاسبة والمخزون ودورة البيع والشراء وتكامل منصات البيع — مصمّمة خصيصاً لبائعي أمازون والعلامات التجارية — ونون قريبًا.")}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {/* Self-serve signup is open (owner, 2026-09-17): the trial is the main path, a
                guided demo the second one. */}
            <Button size="lg" asChild className="text-base">
              <Link href="/signup">{t("ابدأ تجربتك المجانية")}</Link>
            </Button>
            <DemoRequestButton label={t("اطلب ديمو")} size="lg" variant="outline" className="text-base" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {fill(t("{0} يوم مجاناً بكل الوحدات · بدون بطاقة ائتمان · دعم بالعربي على واتساب"), [TRIAL_DAYS])}
          </p>

          {/* Dashboard preview — a live, on-brand mockup of the unified board */}
          <div className="relative mx-auto mt-14 max-w-5xl">
            <div className="absolute inset-x-8 -bottom-6 h-24 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border bg-card text-start shadow-2xl">
              <DashboardPreview />
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">{t("بيانات توضيحية لعرض شكل النظام.")}</p>
          </div>
        </div>
      </section>

      {/* Marketplaces */}
      <section id="marketplaces" className="border-y bg-muted/30 py-10">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <p className="text-center text-sm text-muted-foreground">{t("مصمّم لبائعي أمازون — يستورد الطلبات والتسويات ويرحّلها لحساباتك")}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {MARKETPLACES.map((m) => (
              <span key={m.name} className="flex items-center gap-2 text-xl font-bold text-muted-foreground/70" dir="ltr">
                {t(m.name)}
                {m.soon && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{t("قريبًا")}</span>}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("تجارتك بتكبر… وأدواتك مبعثرة")}</h2>
            <p className="mt-3 text-muted-foreground">{t("لو ده وضعك، إنت مش لوحدك — وفيه طريقة أفضل.")}</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {PAINS.map((p, i) => (
              <div key={i} className="flex items-start gap-4 rounded-2xl border bg-card p-6">
                <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                  <p.icon className="size-5" />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{t(p.text)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="border-y bg-muted/30 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("كل ما تحتاجه — في نظام واحد متّصل")}</h2>
            <p className="mt-3 text-muted-foreground">{t("كل فاتورة وحركة مخزون ودفعة بتترحّل تلقائياً لحساباتك. مصدر واحد للحقيقة.")}</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-md">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <f.icon className="size-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{t(f.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(f.desc)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("ليه SellerCtrl؟")}</h2>
            <p className="mt-3 text-muted-foreground">{t("مش مجرد برنامج محاسبة — نظام تشغيل لتجارتك بالكامل.")}</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {WHY.map((w) => (
              <div key={w.title} className="rounded-2xl border bg-card p-5 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <w.icon className="size-6" />
                </div>
                <h3 className="mt-4 font-bold">{t(w.title)}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{t(w.desc)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y bg-muted/30 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("ابدأ في ثلاث خطوات")}</h2>
            <p className="mt-3 text-muted-foreground">{t("من التسجيل إلى التحكّم الكامل — بدون تعقيد.")}</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border bg-card p-6">
                <div className="grid size-11 place-items-center rounded-2xl bg-primary text-lg font-black text-primary-foreground tabular-nums">{s.n}</div>
                <h3 className="mt-4 text-lg font-bold">{t(s.title)}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(s.desc)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / plans */}
      <section id="pricing" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("باقات تناسب حجم تجارتك")}</h2>
            <p className="mt-3 text-muted-foreground">{t("ابدأ بتجربة مجانية")} {TRIAL_DAYS} {t("يوماً — بدون بطاقة ائتمان. اختر باقتك بعد كده.")}</p>
          </div>
          <Pricing plans={pricing} />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 md:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">{t("أسئلة شائعة")}</h2>
          </div>
          <div className="mt-10 space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="group rounded-2xl border bg-card p-5 [&_summary]:cursor-pointer">
                <summary className="flex items-center justify-between gap-3 font-semibold marker:content-none">
                  {t(f.q)}
                  <span className="text-primary transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t(f.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section id="cta" className="px-4 pb-16 md:px-6">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
          <h2 className="text-3xl font-bold md:text-4xl">{t("جاهز تتحكّم في تجارتك؟")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            {t("ابدأ اليوم وأدِر المحاسبة والمخزون والمبيعات والمشتريات من نظام واحد.")}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90 text-base">
              <Link href="/signup">{t("ابدأ تجربتك المجانية —")} {TRIAL_DAYS} {t("يوم")}</Link>
            </Button>
            <DemoRequestButton label={t("اطلب ديمو")} size="lg" variant="outline" className="border-primary-foreground/40 bg-transparent text-base text-primary-foreground hover:bg-primary-foreground/10" />
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-primary-foreground/80">
            <span className="flex items-center gap-1.5"><Check className="size-4" /> {t("جرّب النظام كامل")}</span>
            <span className="flex items-center gap-1.5"><Check className="size-4" /> {t("إعداد خلال دقائق")}</span>
            <span className="flex items-center gap-1.5"><Check className="size-4" /> {t("دعم بالعربية على واتساب")}</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="space-y-3">
              <Logo className="text-2xl" variant="white" />
              <p className="text-sm text-primary-foreground/70">
                {t("SellerCtrl — نظام ERP عربي موحّد لبائعي أمازون: محاسبة ومخزون وبيع وشراء وربط منصات في مكان واحد.")}
              </p>
            </div>
            <FooterCol title={t("المنتج")} links={[
              { label: "المزايا", href: "#modules" },
              { label: "لماذا نحن", href: "#why" },
              { label: "الأسعار", href: "#pricing" },
              { label: "الأسئلة الشائعة", href: "#faq" },
            ]} />
            <FooterCol title={t("تواصل معنا")} links={[
              { label: "info@sellerctrl.com", href: "mailto:info@sellerctrl.com" },
              { label: "واتساب: 201025246324+", href: "https://wa.me/201025246324" },
              { label: "تسجيل الدخول", href: "/login" },
            ]} />
            <FooterCol title={t("قانوني")} links={[
              { label: "سياسة الخصوصية", href: "/privacy" },
            ]} />
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-primary-foreground/20 pt-6 sm:flex-row">
            <p className="text-sm text-primary-foreground/60">
              © {new Date().getFullYear()} SellerCtrl. {t("جميع الحقوق محفوظة.")}
            </p>
            <div className="flex gap-3">
              <a href="mailto:info@sellerctrl.com" aria-label={t("البريد الإلكتروني")} className="grid size-9 place-items-center rounded-full bg-primary-foreground/10 transition hover:bg-primary-foreground/20">
                <Mail className="size-4" />
              </a>
              <a href="https://wa.me/201025246324" target="_blank" rel="noopener noreferrer" aria-label={t("واتساب")} className="grid size-9 place-items-center rounded-full bg-primary-foreground/10 transition hover:bg-primary-foreground/20">
                <MessageCircle className="size-4" />
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const PREVIEW_NAV = [
  { label: "لوحة التحكم", icon: LayoutDashboard, active: true },
  { label: "المنصات", icon: Store },
  { label: "المحاسبة", icon: Calculator },
  { label: "المشتريات", icon: Truck },
  { label: "المخزون", icon: Warehouse },
  { label: "المبيعات", icon: ShoppingCart },
  { label: "المستثمرون", icon: Coins },
  { label: "الموارد البشرية", icon: UsersRound },
  { label: "التقارير والتحليلات", icon: ChartColumn },
  { label: "الأدوات", icon: Wrench },
  { label: "الإدارة والإعدادات", icon: ShieldCheck },
] as const;

async function DashboardPreview() {
  const t = await getT();
  // Demo (filler) figures so the marketing board reads as a live business, not zeros.
  const kpis = [
    { label: "صافي الربح", value: "124,500", tone: "text-emerald-600" },
    { label: "النقدية والبنك", value: "86,200", tone: "text-foreground" },
    { label: "ذمم مدينة (عملاء)", value: "42,300", tone: "text-foreground" },
    { label: "ذمم دائنة (موردون)", value: "31,800", tone: "text-foreground" },
    { label: "قيمة المخزون", value: "76,733", tone: "text-foreground" },
    { label: "مبيعات هذا الشهر", value: "312,000", tone: "text-foreground" },
  ];
  const alerts = [
    { text: "ذمم متأخرة: 18,400", tone: "text-destructive", bg: "border-destructive/30 bg-destructive/5" },
    { text: "أصناف نافدة: 3", tone: "text-destructive", bg: "border-destructive/30 bg-destructive/5" },
    { text: "مخزون منخفض: 7", tone: "text-amber-700", bg: "border-amber-500/30 bg-amber-500/5" },
  ];
  const tiles = [
    { title: "المحاسبة", desc: "دليل الحسابات، القيود، التقارير المالية", icon: Calculator },
    { title: "المبيعات", desc: "العملاء، أوامر البيع، الفواتير، أمازون", icon: ShoppingCart },
    { title: "المشتريات", desc: "الموردون، أوامر الشراء، الفواتير", icon: Truck },
    { title: "المخزون", desc: "الأصناف، الأرصدة، الحركة، التسويات", icon: Boxes },
    { title: "الموارد البشرية", desc: "الموظفون ومسير الرواتب", icon: UserCog },
    { title: "المستثمرون", desc: "المستثمرون وحصصهم", icon: Coins },
    { title: "التقارير", desc: "ميزان المراجعة، الدخل، الميزانية، الضريبة", icon: ChartPie },
  ];
  return (
    <div className="flex">
      {/* Sidebar — dark blue, on the start side like the live shell (right in Arabic) */}
      <aside className="hidden w-52 shrink-0 flex-col bg-primary p-3 text-primary-foreground md:flex">
        <div className="mb-4 px-2 pt-1"><Logo className="text-lg" variant="white" /></div>
        <nav className="space-y-0.5">
          {PREVIEW_NAV.map((it) => (
            <div key={it.label} className={cn("flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium", "active" in it && it.active ? "bg-white text-primary shadow-sm" : "text-primary-foreground/80")}>
              <span className="flex items-center gap-2.5"><it.icon className="size-4 shrink-0" />{t(it.label)}</span>
              {!("active" in it && it.active) && <ChevronDown className="size-3 opacity-50" />}
            </div>
          ))}
        </nav>
        <div className="mt-auto pt-3 text-[9px] text-primary-foreground/50">SellerCtrl · v1.0</div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 bg-muted/20">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"><Search className="size-3 shrink-0" /> {t("بحث…")}</div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="relative grid size-7 place-items-center rounded-lg bg-muted">
              <Bell className="size-3.5 text-muted-foreground" />
              <span className="absolute -left-1.5 -top-1.5 rounded-full bg-destructive px-1 text-[8px] font-bold leading-4 text-white">+99</span>
            </span>
            <span className="hidden items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-[11px] font-medium sm:flex"><Building2 className="size-3 text-primary" />{t("سيلر كنترول")}</span>
            <span className="flex items-center gap-1.5"><span className="grid size-7 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{t("مدير النظام").split(" ").map((w) => w[0]).join("")}</span><span className="hidden text-[11px] font-medium lg:block">{t("مدير النظام")}</span></span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5">
          <div className="mb-4">
            <div className="text-base font-bold">{t("مرحباً، مدير النظام")}</div>
            <div className="text-[11px] text-muted-foreground">{t("نظام سيلر كنترول — نظرة عامة سريعة.")}</div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border bg-card p-3">
                <div className="truncate text-[10px] text-muted-foreground">{t(k.label)}</div>
                <div className={cn("mt-1 text-base font-bold tabular-nums", k.tone)}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          <div className="mt-3 flex flex-wrap gap-2">
            {alerts.map((a) => (
              <span key={a.text} className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-medium", a.bg, a.tone)}>{t(a.text)}</span>
            ))}
          </div>

          {/* Modules */}
          <div className="mt-4 mb-2 text-[11px] font-semibold text-muted-foreground">{t("الوحدات")}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((tl) => (
              <div key={tl.title} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{t(tl.title)}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{t(tl.desc)}</div>
                </div>
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><tl.icon className="size-4" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

async function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  const t = await getT();
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-primary-foreground/70">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="hover:text-primary-foreground">{t(l.label)}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
