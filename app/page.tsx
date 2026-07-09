import Link from "next/link";
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
  ArrowLeft,
  Users,
  Truck,
  Search,
  ChartPie,
  Globe,
  Mail,
  Share2,
  Check,
  HardDrive,
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
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { Logo } from "@/components/brand/logo";
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
  { icon: Store, title: "منصات البيع", desc: "اربط أمازون ونون — استورد الطلبات والتسويات والمرتجعات، وكل عملية تترحّل لمخزونك وحساباتك تلقائياً." },
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

const MARKETPLACES = ["amazon", "noon", "Trendyol", "جرير", "سوق"];

export default async function Home() {
  // Degrade to the empty-state pricing card if the DB is unreachable at build/runtime.
  const catalog = await db.select().from(plans).where(eq(plans.isActive, true))
    .orderBy(asc(plans.sortOrder), asc(plans.priceMonthly)).catch(() => []);
  const pricing = catalog.map((p) => ({
    name: p.name, priceMonthly: Number(p.priceMonthly), priceAnnual: Number(p.priceAnnual),
    maxUsers: p.maxUsers, storageGb: p.storageGb, modules: p.enabledModules ?? [],
  }));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Logo className="text-2xl text-primary" />
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#modules" className="hover:text-foreground">الموديولات</a>
            <a href="#why" className="hover:text-foreground">لماذا نحن</a>
            <a href="#pricing" className="hover:text-foreground">الأسعار</a>
            <a href="#how" className="hover:text-foreground">كيف يعمل</a>
            <a href="#faq" className="hover:text-foreground">الأسئلة</a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <Link href="/login">تسجيل الدخول</Link>
            </Button>
            <Button asChild className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90">
              <Link href="/login">ابدأ الآن</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center md:py-24 md:px-6">
          <span className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-4 py-1.5 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-primary" />
            نظام ERP عربي متكامل للبائعين
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">
            نظام واحد يدير تجارتك
            <span className="text-primary"> بالكامل</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            منصة متكاملة تجمع المحاسبة والمخزون ودورة البيع والشراء وتكامل منصات البيع —
            مصمّمة خصيصاً لبائعي أمازون ونون والعلامات التجارية.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="text-base">
              <Link href="/login">
                ابدأ مجاناً الآن
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-base">
              <Link href="/login">شاهد عرضاً توضيحياً</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            بدون بطاقة ائتمان · إعداد في دقائق · دعم بالعربي
          </p>

          {/* Dashboard preview — a live, on-brand mockup of the unified board */}
          <div className="relative mx-auto mt-14 max-w-5xl">
            <div className="absolute inset-x-8 -bottom-6 h-24 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border bg-card text-right shadow-2xl">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Marketplaces */}
      <section id="marketplaces" className="border-y bg-muted/30 py-10">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <p className="text-center text-sm text-muted-foreground">يدير تجارتك على مختلف المنصات</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {MARKETPLACES.map((m) => (
              <span key={m} className="text-xl font-bold text-muted-foreground/70" dir="ltr">
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">تجارتك بتكبر… وأدواتك مبعثرة</h2>
            <p className="mt-3 text-muted-foreground">لو ده وضعك، إنت مش لوحدك — وفيه طريقة أفضل.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {PAINS.map((p, i) => (
              <div key={i} className="flex items-start gap-4 rounded-2xl border bg-card p-6">
                <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                  <p.icon className="size-5" />
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">{p.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section id="modules" className="border-y bg-muted/30 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">كل ما تحتاجه — في نظام واحد متّصل</h2>
            <p className="mt-3 text-muted-foreground">كل فاتورة وحركة مخزون ودفعة بتترحّل تلقائياً لحساباتك. مصدر واحد للحقيقة.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-md">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <f.icon className="size-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why us */}
      <section id="why" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">ليه SellerCtrl؟</h2>
            <p className="mt-3 text-muted-foreground">مش مجرد برنامج محاسبة — نظام تشغيل لتجارتك بالكامل.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {WHY.map((w) => (
              <div key={w.title} className="rounded-2xl border bg-card p-5 text-center">
                <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <w.icon className="size-6" />
                </div>
                <h3 className="mt-4 font-bold">{w.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-y bg-muted/30 py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">ابدأ في ثلاث خطوات</h2>
            <p className="mt-3 text-muted-foreground">من التسجيل إلى التحكّم الكامل — بدون تعقيد.</p>
          </div>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="rounded-2xl border bg-card p-6">
                <div className="grid size-11 place-items-center rounded-2xl bg-primary text-lg font-black text-primary-foreground tabular-nums">{s.n}</div>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing / plans */}
      <section id="pricing" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">باقات تناسب حجم تجارتك</h2>
            <p className="mt-3 text-muted-foreground">ابدأ بتجربة مجانية ١٤ يوماً — بدون بطاقة ائتمان. اختر باقتك بعد كده.</p>
          </div>
          <Pricing plans={pricing} />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-16 md:py-24">
        <div className="mx-auto max-w-3xl px-4 md:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">أسئلة شائعة</h2>
          </div>
          <div className="mt-10 space-y-3">
            {FAQS.map((f, i) => (
              <details key={i} className="group rounded-2xl border bg-card p-5 [&_summary]:cursor-pointer">
                <summary className="flex items-center justify-between gap-3 font-semibold marker:content-none">
                  {f.q}
                  <span className="text-primary transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section id="cta" className="px-4 pb-16 md:px-6">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
          <h2 className="text-3xl font-bold md:text-4xl">جاهز تتحكّم في تجارتك؟</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            ابدأ اليوم وأدِر المحاسبة والمخزون والمبيعات والمشتريات من نظام واحد.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="bg-brand-yellow text-foreground hover:bg-brand-yellow/90 text-base">
              <Link href="/login">ابدأ الآن مجاناً</Link>
            </Button>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-primary-foreground/80">
            <span className="flex items-center gap-1.5"><Check className="size-4" /> بدون بطاقة ائتمان</span>
            <span className="flex items-center gap-1.5"><Check className="size-4" /> إعداد خلال دقائق</span>
            <span className="flex items-center gap-1.5"><Check className="size-4" /> دعم بالعربية</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-primary text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 py-12 md:px-6">
          <div className="grid gap-8 md:grid-cols-4">
            <div className="space-y-3">
              <Logo className="text-2xl text-primary-foreground" />
              <p className="text-sm text-primary-foreground/70">
                SellerCtrl — نظام ERP موحّد يدير تجارتك بالكامل من مكان واحد.
              </p>
            </div>
            <FooterCol title="المنتج" links={["الموديولات", "لماذا نحن", "الأسعار", "الأمان"]} />
            <FooterCol title="الشركة" links={["من نحن", "المدونة", "الوظائف", "تواصل معنا"]} />
            <FooterCol title="الدعم" links={["المساعدة", "التوثيق", "الحالة", "سياسة الخصوصية"]} />
          </div>
          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-primary-foreground/20 pt-6 sm:flex-row">
            <p className="text-sm text-primary-foreground/60">
              © {new Date().getFullYear()} SellerCtrl. جميع الحقوق محفوظة.
            </p>
            <div className="flex gap-3">
              {[Globe, Mail, Share2].map((I, i) => (
                <a key={i} href="#" className="grid size-9 place-items-center rounded-full bg-primary-foreground/10 transition hover:bg-primary-foreground/20">
                  <I className="size-4" />
                </a>
              ))}
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

function DashboardPreview() {
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
    <div className="flex" dir="rtl">
      {/* Sidebar — dark blue, right side in RTL (matches the live shell) */}
      <aside className="hidden w-52 shrink-0 flex-col bg-primary p-3 text-primary-foreground md:flex">
        <div className="mb-4 px-2 pt-1"><Logo className="text-lg text-primary-foreground" /></div>
        <nav className="space-y-0.5">
          {PREVIEW_NAV.map((it) => (
            <div key={it.label} className={cn("flex items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium", "active" in it && it.active ? "bg-white text-primary shadow-sm" : "text-primary-foreground/80")}>
              <span className="flex items-center gap-2.5"><it.icon className="size-4 shrink-0" />{it.label}</span>
              {!("active" in it && it.active) && <ChevronDown className="size-3 opacity-50" />}
            </div>
          ))}
        </nav>
        <div className="mt-auto pt-3 text-[9px] text-primary-foreground/50">SellerCtrl Workspace OS · v1.0</div>
      </aside>

      {/* Main */}
      <div className="min-w-0 flex-1 bg-muted/20">
        {/* Top bar */}
        <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground"><Search className="size-3 shrink-0" /> بحث…</div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="relative grid size-7 place-items-center rounded-lg bg-muted">
              <Bell className="size-3.5 text-muted-foreground" />
              <span className="absolute -left-1.5 -top-1.5 rounded-full bg-destructive px-1 text-[8px] font-bold leading-4 text-white">+99</span>
            </span>
            <span className="hidden items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1 text-[11px] font-medium sm:flex"><Building2 className="size-3 text-primary" />سيلر كنترول</span>
            <span className="flex items-center gap-1.5"><span className="grid size-7 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">ما</span><span className="hidden text-[11px] font-medium lg:block">مدير النظام</span></span>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-5">
          <div className="mb-4">
            <div className="text-base font-bold">مرحباً، مدير النظام</div>
            <div className="text-[11px] text-muted-foreground">نظام سيلر كنترول — نظرة عامة سريعة.</div>
          </div>

          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 sm:gap-3">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border bg-card p-3">
                <div className="truncate text-[10px] text-muted-foreground">{k.label}</div>
                <div className={cn("mt-1 text-base font-bold tabular-nums", k.tone)}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Alerts */}
          <div className="mt-3 flex flex-wrap gap-2">
            {alerts.map((a) => (
              <span key={a.text} className={cn("rounded-lg border px-2.5 py-1.5 text-[10px] font-medium", a.bg, a.tone)}>{a.text}</span>
            ))}
          </div>

          {/* Modules */}
          <div className="mt-4 mb-2 text-[11px] font-semibold text-muted-foreground">الوحدات</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map((t) => (
              <div key={t.title} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{t.title}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{t.desc}</div>
                </div>
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><t.icon className="size-4" /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type PlanCard = { name: string; priceMonthly: number; priceAnnual: number; maxUsers: number | null; storageGb: number | null; modules: string[] };

function Pricing({ plans }: { plans: PlanCard[] }) {
  const egp = (n: number) => n.toLocaleString("ar-EG");
  if (plans.length === 0) {
    return (
      <div className="mt-10 rounded-3xl border bg-card p-10 text-center">
        <p className="text-lg font-semibold">خطط مرنة تناسب كل حجم</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">ابدأ تجربتك المجانية الآن، وتواصل معنا لاختيار الباقة المناسبة لعدد مستخدميك وحجم تخزينك.</p>
        <Button asChild className="mt-6"><Link href="/login">ابدأ التجربة المجانية <ArrowLeft className="size-4" /></Link></Button>
      </div>
    );
  }
  const popular = plans.length >= 3 ? Math.floor(plans.length / 2) : -1;
  return (
    <div className={cn("mt-12 grid gap-6", plans.length >= 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 max-w-3xl mx-auto")}>
      {plans.map((p, i) => (
        <div key={p.name} className={cn("relative flex flex-col rounded-2xl border bg-card p-6", i === popular && "border-primary shadow-lg ring-1 ring-primary")}>
          {i === popular && <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">الأكثر شيوعاً</span>}
          <h3 className="text-lg font-bold">{p.name}</h3>
          <div className="mt-3 flex items-end gap-1">
            <span className="text-3xl font-black tabular-nums">{p.priceMonthly > 0 ? egp(p.priceMonthly) : "مجاناً"}</span>
            {p.priceMonthly > 0 && <span className="pb-1 text-sm text-muted-foreground">ج.م / شهر</span>}
          </div>
          {p.priceAnnual > 0 && <div className="mt-1 text-xs text-muted-foreground">أو {egp(p.priceAnnual)} ج.م سنوياً</div>}
          <ul className="mt-5 flex-1 space-y-2 text-sm">
            <li className="flex items-center gap-2"><Users className="size-4 text-primary" />حتى {p.maxUsers == null ? "عدد غير محدود من المستخدمين" : `${egp(p.maxUsers)} مستخدم`}</li>
            <li className="flex items-center gap-2"><HardDrive className="size-4 text-primary" />تخزين {p.storageGb == null ? "غير محدود" : `${egp(p.storageGb)} جيجابايت`}</li>
            {p.modules.map((m) => (
              <li key={m} className="flex items-center gap-2"><Check className="size-4 text-primary" />{MODULE_LABELS[m] ?? m}</li>
            ))}
          </ul>
          <Button asChild variant={i === popular ? "default" : "outline"} className="mt-6 w-full"><Link href="/login">ابدأ التجربة</Link></Button>
        </div>
      ))}
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: string[] }) {
  return (
    <div>
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-primary-foreground/70">
        {links.map((l) => (
          <li key={l}>
            <a href="#" className="hover:text-primary-foreground">{l}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
