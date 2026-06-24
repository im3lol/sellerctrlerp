import Link from "next/link";
import Image from "next/image";
import {
  Calculator,
  Boxes,
  ShoppingCart,
  ReceiptText,
  Target,
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
  Globe,
  Mail,
  Share2,
  Check,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

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
  { icon: Target, title: "CRM وخط أنابيب مبيعات", desc: "أدِر العملاء والفرص بأسلوب Kanban — من عميل محتمل إلى صفقة مكسوبة تتحوّل لأمر بيع بضغطة." },
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

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Logo className="text-2xl text-primary" />
          <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
            <a href="#modules" className="hover:text-foreground">الموديولات</a>
            <a href="#why" className="hover:text-foreground">لماذا نحن</a>
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
            منصة ERP + CRM عربية متكاملة للبائعين
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">
            نظام واحد يدير تجارتك
            <span className="text-primary"> بالكامل</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            منصة متكاملة تجمع المحاسبة والمخزون ودورة البيع والشراء وإدارة العملاء —
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

          {/* Dashboard preview */}
          <div className="relative mx-auto mt-14 max-w-5xl">
            <div className="absolute inset-x-8 -bottom-6 h-24 rounded-full bg-primary/20 blur-3xl" />
            <div className="relative overflow-hidden rounded-2xl border bg-card shadow-2xl">
              <Image
                src="/brand/dashboard-mockup.png"
                alt="لوحة تحكم SellerCtrl"
                width={1200}
                height={750}
                priority
                className="w-full"
              />
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
                SellerCtrl — نظام ERP و CRM موحّد يدير تجارتك بالكامل من مكان واحد.
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
