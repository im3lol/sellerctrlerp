import Link from "next/link";
import Image from "next/image";
import {
  Briefcase,
  Shuffle,
  Sheet,
  ListChecks,
  BarChart3,
  Clock,
  ShieldCheck,
  ArrowLeft,
  Globe,
  Mail,
  Share2,
  Check,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

const FEATURES = [
  { icon: Briefcase, title: "مساحات عمل مستقلة", desc: "كل عميل أو متجر في مساحة عمل خاصة بفريقه وملفاته ومهامه." },
  { icon: Shuffle, title: "توزيع تلقائي للعمل", desc: "وزّع آلاف المنتجات على الموظفين بالتساوي أو حسب الأداء والخبرة." },
  { icon: Sheet, title: "ربط Google Sheets", desc: "استيراد ومزامنة المنتجات تلقائياً كل 5 دقائق من جداولك." },
  { icon: ListChecks, title: "إدارة المهام وكانبان", desc: "نظام مهام كامل مع لوحة كانبان والسحب والإفلات والمهام المتكررة." },
  { icon: Clock, title: "الحضور والإنتاجية", desc: "تسجيل الحضور والانصراف واحتساب ساعات العمل ومؤشرات الأداء." },
  { icon: BarChart3, title: "تقارير ومؤشرات", desc: "لوحات تحكم وتقارير يومية وأسبوعية وشهرية ولوحة متصدرين." },
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
            <a href="#features" className="hover:text-foreground">المميزات</a>
            <a href="#marketplaces" className="hover:text-foreground">المنصات</a>
            <a href="#cta" className="hover:text-foreground">ابدأ</a>
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
            نظام إدارة عمليات متكامل للبائعين
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black leading-tight tracking-tight md:text-6xl">
            تحكم كامل في عملياتك
            <span className="text-primary"> من مكان واحد</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground">
            نظام داخلي لإدارة الموظفين والعملاء والمنتجات والمهام، مع توزيع تلقائي للعمل،
            ومراقبة الأداء، وربط مباشر مع Google Sheets.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" asChild className="text-base">
              <Link href="/login">
                ابدأ تجربتك المجانية
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild className="text-base">
              <Link href="/login">تسجيل الدخول</Link>
            </Button>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            موثوق به لإدارة أكثر من <span className="font-bold text-foreground">٤٬٥٠٠</span> منتج يومياً
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
          <p className="text-center text-sm text-muted-foreground">يدعم إدارة متاجرك على مختلف المنصات</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-12 gap-y-4">
            {MARKETPLACES.map((m) => (
              <span key={m} className="text-xl font-bold text-muted-foreground/70" dir="ltr">
                {m}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-16 md:py-24">
        <div className="mx-auto max-w-6xl px-4 md:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">كل ما تحتاجه لإدارة عملياتك</h2>
            <p className="mt-3 text-muted-foreground">منصة واحدة تجمع الفرق والمنتجات والمهام والتقارير.</p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border bg-card p-6 transition-shadow hover:shadow-md">
                <div className="grid size-12 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <f.icon className="size-6" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA band */}
      <section id="cta" className="px-4 pb-16 md:px-6">
        <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center text-primary-foreground">
          <h2 className="text-3xl font-bold md:text-4xl">جاهز للتحكم الكامل في عملياتك؟</h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            ابدأ اليوم وأدر فريقك ومنتجاتك ومهامك من لوحة تحكم واحدة.
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
                نظام إدارة عمليات SellerCtrl — تحكم كامل في عملياتك من مكان واحد.
              </p>
            </div>
            <FooterCol title="المنتج" links={["المميزات", "المنصات", "الأسعار", "الأمان"]} />
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
