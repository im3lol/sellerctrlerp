import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";

export const metadata = { title: "سياسة الخصوصية — SellerCtrl" };

const UPDATED = "٢٩ يوليو ٢٠٢٦";

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "١. البيانات التي نجمعها",
    p: [
      "بيانات الحساب: اسمك، بريدك الإلكتروني، اسم مؤسستك، ورقم هاتفك عند التسجيل.",
      "بيانات التشغيل التي تُدخلها في النظام: الأصناف، العملاء، الموردون، الفواتير، القيود المحاسبية، والمخزون.",
      "بيانات ربط المنصات: عند ربط حساب أمازون، نحفظ رمز الوصول (Refresh Token) مشفّرًا لاستيراد طلباتك وتسوياتك — لا نطّلع على كلمة مرور حسابك على أمازون إطلاقًا.",
      "بيانات فنية أساسية لتشغيل الخدمة وحمايتها (سجلات الدخول والنشاط).",
    ],
  },
  {
    h: "٢. كيف نستخدم بياناتك",
    p: [
      "لتشغيل النظام وتقديم خدماته لك: المحاسبة والمخزون ودورة البيع والشراء وربط المنصات.",
      "لاستيراد طلبات ومدفوعات أمازون وترحيلها تلقائيًا إلى حساباتك ومخزونك.",
      "للتواصل معك بخصوص حسابك واشتراكك والدعم الفني.",
      "لا نبيع بياناتك ولا نؤجّرها لأي طرف ثالث لأغراض تسويقية.",
    ],
  },
  {
    h: "٣. عزل البيانات والأمان",
    p: [
      "بيانات كل مؤسسة معزولة تمامًا عن غيرها؛ لا يمكن لمؤسسة الاطّلاع على بيانات مؤسسة أخرى.",
      "الوصول داخل مؤسستك محكوم بصلاحيات دقيقة لكل مستخدم.",
      "الأسرار الحساسة (مثل رموز ربط المنصات) تُخزَّن مشفّرة، والاتصال بالنظام يتم عبر قناة مؤمّنة (HTTPS).",
    ],
  },
  {
    h: "٤. مزوّدو الخدمة",
    p: [
      "نستعين بمزوّدي بنية تحتية موثوقين للاستضافة وقواعد البيانات، ونشارك معهم الحد الأدنى اللازم لتشغيل الخدمة فقط.",
      "عند تفعيل الدفع الإلكتروني، تتم معالجة الدفع عبر بوابة دفع متخصّصة — لا نخزّن بيانات بطاقتك على أنظمتنا.",
    ],
  },
  {
    h: "٥. الاحتفاظ بالبيانات وحذفها",
    p: [
      "نحتفظ ببياناتك طوال مدة اشتراكك النشط.",
      "يمكنك طلب حذف حساب مؤسستك وكل بياناته نهائيًا في أي وقت عبر التواصل معنا.",
    ],
  },
  {
    h: "٦. حقوقك",
    p: [
      "لك الحق في الوصول إلى بياناتك وتصحيحها وتصديرها وطلب حذفها.",
      "للتواصل بشأن أي من هذه الحقوق، راسلنا على البريد أدناه.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4 md:px-6">
          <Link href="/"><Logo className="text-2xl text-primary" /></Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            الرئيسية <ArrowRight className="size-4" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12 md:px-6" dir="rtl">
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">سياسة الخصوصية</h1>
        <p className="mt-2 text-sm text-muted-foreground">آخر تحديث: {UPDATED}</p>
        <p className="mt-6 leading-relaxed text-muted-foreground">
          خصوصيتك وأمان بياناتك أولوية عندنا. توضّح هذه السياسة البيانات التي يجمعها نظام SellerCtrl وكيف
          نستخدمها ونحميها. باستخدامك للنظام فأنت توافق على ما ورد في هذه الصفحة.
        </p>

        <div className="mt-10 space-y-8">
          {SECTIONS.map((s) => (
            <section key={s.h}>
              <h2 className="text-lg font-bold">{s.h}</h2>
              <ul className="mt-3 space-y-2">
                {s.p.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-muted-foreground">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="rounded-2xl border bg-muted/30 p-6">
            <h2 className="text-lg font-bold">٧. تواصل معنا</h2>
            <p className="mt-2 text-sm text-muted-foreground">لأي استفسار عن الخصوصية أو بياناتك:</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              <li>البريد الإلكتروني: <a href="mailto:info@sellerctrl.com" className="font-medium text-primary hover:underline" dir="ltr">info@sellerctrl.com</a></li>
              <li>واتساب/هاتف: <a href="https://wa.me/201025246324" className="font-medium text-primary hover:underline" dir="ltr">+201025246324</a></li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
