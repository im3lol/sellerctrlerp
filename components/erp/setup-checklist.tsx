import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import type { SetupStatus } from "@/lib/erp/setup-status";

type Step = {
  key: keyof SetupStatus;
  icon: string;
  title: string;
  desc: string;
  ctas: { label: string; href: string }[];
  optional?: boolean;
};

const STEPS: Step[] = [
  { key: "company", icon: "Building2", title: "بيانات الشركة", desc: "الاسم القانوني والرقم الضريبي وبداية السنة المالية والشعار — تظهر على فواتيرك المطبوعة.", ctas: [{ label: "فتح الإعدادات", href: "/settings" }] },
  { key: "chart", icon: "BookOpen", title: "دليل الحسابات", desc: "أُنشئ لك دليل قياسي كامل تلقائيًا — راجعه وعدّل ما يلزم ليطابق نشاطك.", ctas: [{ label: "مراجعة الدليل", href: "/accounting/chart" }] },
  { key: "units", icon: "Ruler", title: "وحدات القياس", desc: "قطعة، كرتونة، كيلو… تحتاج وحدة واحدة على الأقل قبل إضافة الأصناف.", ctas: [{ label: "إدارة الوحدات", href: "/inventory/items" }] },
  { key: "warehouses", icon: "Warehouse", title: "المخازن", desc: "أُنشئ «المستودع الرئيسي» تلقائيًا — أضف مخازن أخرى لو عندك أكثر من موقع.", ctas: [{ label: "المخازن", href: "/inventory/warehouses" }] },
  { key: "items", icon: "Package", title: "الأصناف", desc: "أضف منتجاتك: يدويًا واحدًا واحدًا، أو استيراد ملف دفعة واحدة، أو مزامنة مباشرة من أمازون.", ctas: [
    { label: "صنف جديد", href: "/inventory/items/new" },
    { label: "استيراد ملف", href: "/imports" },
    { label: "مزامنة أمازون", href: "/platforms" },
  ] },
  { key: "customers", icon: "Users", title: "العملاء", desc: "أضف عملاءك (منصات البيع تُنشئ عميلها تلقائيًا عند ربطها).", ctas: [{ label: "العملاء", href: "/sales/customers" }] },
  { key: "suppliers", icon: "Truck", title: "الموردون", desc: "أضف مورّديك لتسجيل المشتريات وأذون الاستلام والفواتير.", ctas: [{ label: "الموردون", href: "/purchases/suppliers" }] },
  { key: "opening", icon: "Scale", title: "الأرصدة الافتتاحية", desc: "منتقل من نظام آخر؟ أدخل أرصدة المخزون والعملاء والموردين والبنوك كما هي اليوم. شركة جديدة؟ تخطَّ هذه الخطوة.", ctas: [{ label: "الأرصدة الافتتاحية", href: "/settings/opening-balance" }], optional: true },
  { key: "numbering", icon: "Hash", title: "ترقيم المستندات", desc: "غيّر بادئات أرقام الفواتير والأوامر (SI، SO…) لو أردت ترقيمًا خاصًا — الافتراضي جاهز.", ctas: [{ label: "الترقيم", href: "/settings/numbering" }], optional: true },
  { key: "platform", icon: "Store", title: "ربط منصة بيع", desc: "اربط أمازون أو أضف منصة يدوية — مبيعاتها ومدفوعاتها تتزامن أو تُستورد لعميلها ومخزنها.", ctas: [{ label: "المنصات", href: "/platforms" }], optional: true },
];

function StepCard({ step, done, isNext }: { step: Step; done: boolean; isNext: boolean }) {
  return (
    <Card className={isNext ? "ring-1 ring-primary border-primary" : done ? "opacity-80" : ""}>
      <CardContent className="flex items-start gap-4 pt-6">
        {done
          ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" />
          : <Circle className={`mt-0.5 size-6 shrink-0 ${isNext ? "text-primary" : "text-muted-foreground/40"}`} />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name={step.icon} className="size-4 text-muted-foreground" />
            <span className="font-semibold">{step.title}</span>
            {step.optional && <Badge variant="secondary">اختياري</Badge>}
            {isNext && <Badge>الخطوة التالية</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
          {!done && (
            <div className="mt-3 flex flex-wrap gap-2">
              {step.ctas.map((c, i) => (
                <Button key={c.href} asChild size="sm" variant={isNext && i === 0 ? "default" : "outline"}>
                  <Link href={c.href}>{c.label}</Link>
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Server component: the full checklist, driven entirely by derived SetupStatus. */
export function SetupChecklist({ status }: { status: SetupStatus }) {
  const essential = STEPS.filter((s) => !s.optional);
  const optional = STEPS.filter((s) => s.optional);
  const next = essential.find((s) => !status[s.key]);
  const pct = Math.round((status.essentialDone / status.essentialTotal) * 100);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-lg font-bold">{pct === 100 ? "اكتمل الإعداد الأساسي 🎉" : `اكتمل ${status.essentialDone} من ${status.essentialTotal} خطوات أساسية`}</div>
              <div className="text-sm text-muted-foreground">{pct === 100 ? "جاهز للعمل — راجع الخطوات الاختيارية لو تحتاجها." : "أكمل الخطوات بالترتيب — كل خطوة تتعلّم تلقائيًا أول ما تنفّذها."}</div>
            </div>
            <div className="text-2xl font-bold tabular-nums text-primary">{pct}٪</div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {essential.map((s) => <StepCard key={s.key} step={s} done={!!status[s.key]} isNext={s.key === next?.key} />)}
      </div>

      <div className="pt-2 text-sm font-semibold text-muted-foreground">خطوات اختيارية</div>
      <div className="space-y-3">
        {optional.map((s) => <StepCard key={s.key} step={s} done={!!status[s.key]} isNext={false} />)}
      </div>
    </div>
  );
}
