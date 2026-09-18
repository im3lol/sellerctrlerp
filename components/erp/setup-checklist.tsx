import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";
import type { SetupStatus } from "@/lib/erp/setup-status";
import { markSetupStepDoneAction } from "@/app/actions/erp/settings";

type Step = {
  key: string;
  icon: string;
  title: string;
  desc: string;
  ctas: { label: string; href: string }[];
  optional?: boolean;
};

const STEPS: Step[] = [
  { key: "basis", icon: "CalendarRange", title: "الأساس المحاسبي", desc: "أول وأهم خطوة: بداية السنة المالية (افتراضيًا 1 يناير — غيّرها لو سنتك المالية مختلفة) والعملة الأساسية (الجنيه المصري افتراضيًا). تحكم كل فتراتك المحاسبية وتقاريرك — تُقفل بعد أول عملية، فاضبطها الآن.", ctas: [
    { label: "ضبط الأساس المحاسبي", href: "/settings/organization" },
    { label: "العملة الأساسية", href: "/settings/currencies" },
  ] },
  { key: "company", icon: "Building2", title: "بيانات الشركة", desc: "أدخل الرقم الضريبي (يظهر على فواتيرك الضريبية) مع الاسم القانوني والشعار. لست مسجّلاً ضريبيًا؟ اضغط الدائرة لتمييز الخطوة كمكتملة.", ctas: [{ label: "فتح الإعدادات", href: "/settings/organization" }] },
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
  { key: "opening", icon: "Scale", title: "الأرصدة الافتتاحية", desc: "الأهم قبل أول عملية: أدخل أرصدة المخزون والعملاء والموردين والبنوك كما هي اليوم — تقدر تسحب كميات مخزونك مباشرة من أمازون. شركة جديدة بلا أرصدة؟ اضغط الدائرة لتمييزها كمكتملة.", ctas: [{ label: "الأرصدة الافتتاحية", href: "/settings/opening-balance" }] },
  { key: "numbering", icon: "Hash", title: "ترقيم المستندات", desc: "غيّر بادئات أرقام الفواتير والأوامر (SI، SO…) لو أردت ترقيمًا خاصًا — الافتراضي جاهز.", ctas: [{ label: "الترقيم", href: "/settings/numbering" }], optional: true },
  { key: "platform", icon: "Store", title: "ربط منصة بيع", desc: "اربط أمازون أو أضف منصة يدوية — مبيعاتها ومدفوعاتها تتزامن أو تُستورد لعميلها ومخزنها.", ctas: [{ label: "المنصات", href: "/platforms" }], optional: true },
];

type AmazonKey = keyof NonNullable<SetupStatus["amazon"]>;
// Derived from real sync data only — no "mark done" circle, the step is done when Amazon says so.
const AMAZON_STEPS: (Step & { key: AmazonKey })[] = [
  { key: "connected", icon: "Link", title: "اربط حساب أمازون", desc: "من صفحة المنصات: «ربط أمازون» ووافق على الصلاحيات في Seller Central. لو الربط انتهى هتلاقيها هنا مش متعلّمة.", ctas: [{ label: "المنصات", href: "/platforms" }] },
  { key: "firstSync", icon: "RefreshCw", title: "أول مزامنة", desc: "شغّل «مزامنة الآن» من صفحة أمازون — بتجيب المنتجات والطلبات لأول مرة.", ctas: [{ label: "المنصات", href: "/platforms" }] },
  { key: "skusLinked", icon: "ListChecks", title: "اربط الـSKUs بالأصناف", desc: "أي طلب فيه SKU مش معروف بيستنى في «طلبات بمنتج غير معروف» — اربطه بصنفه وهيتسجّل لوحده.", ctas: [{ label: "طلبات بمنتج غير معروف", href: "/sales/orders/unmatched" }] },
  { key: "fbaAudited", icon: "ClipboardCheck", title: "أول تدقيق مخزون FBA", desc: "قارن مخزون أمازون بمخزون النظام — بعدها خطة الشحن بتشتغل على أرقام أمازون الحقيقية.", ctas: [{ label: "مطابقة المخزون", href: "/inventory/reconciliation" }] },
];

function StepCard({ step, done, isNext, manual = true }: { step: Step; done: boolean; isNext: boolean; manual?: boolean }) {
  return (
    <Card className={isNext ? "ring-1 ring-primary border-primary" : done ? "opacity-80" : ""}>
      <CardContent className="flex items-start gap-4 pt-6">
        {done
          ? <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" />
          : !manual ? <Circle className={`mt-0.5 size-6 shrink-0 ${isNext ? "text-primary" : "text-muted-foreground/40"}`} />
          : (
            <form action={markSetupStepDoneAction} className="shrink-0">
              <input type="hidden" name="key" value={step.key} />
              <button type="submit" title="اضغط لتمييز الخطوة كمكتملة" className="group mt-0.5 grid place-items-center rounded-full">
                <Circle className={`size-6 group-hover:hidden ${isNext ? "text-primary" : "text-muted-foreground/40"}`} />
                <CheckCircle2 className="hidden size-6 text-emerald-600 group-hover:block" />
              </button>
            </form>
          )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Icon name={step.icon} className="size-4 text-muted-foreground" />
            <span className="font-semibold">{step.title}</span>
            {step.optional && <Badge variant="secondary">اختياري</Badge>}
            {isNext && <Badge>الخطوة التالية</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{step.desc}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {step.ctas.map((c, i) => (
              <Button key={c.href} asChild size="sm" variant={!done && isNext && i === 0 ? "default" : "outline"}>
                <Link href={c.href}>{c.label}</Link>
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** Server component: the full checklist, driven entirely by derived SetupStatus. */
export function SetupChecklist({ status }: { status: SetupStatus }) {
  const essential = STEPS.filter((s) => !s.optional);
  const optional = STEPS.filter((s) => s.optional);
  const next = essential.find((s) => !status[s.key as keyof SetupStatus]);
  const amazon = status.amazon;
  const nextAmazon = amazon && AMAZON_STEPS.find((s) => !amazon[s.key]);
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
        {essential.map((s) => <StepCard key={s.key} step={s} done={!!status[s.key as keyof SetupStatus]} isNext={s.key === next?.key} />)}
      </div>

      {amazon && (
        <>
          <div className="pt-2 text-sm font-semibold text-muted-foreground">
            أمازون — {AMAZON_STEPS.filter((s) => amazon[s.key]).length} من {AMAZON_STEPS.length}
          </div>
          <div className="space-y-3">
            {AMAZON_STEPS.map((s) => <StepCard key={s.key} step={s} done={amazon[s.key]} isNext={s.key === nextAmazon?.key} manual={false} />)}
          </div>
        </>
      )}

      <div className="pt-2 text-sm font-semibold text-muted-foreground">خطوات اختيارية</div>
      <div className="space-y-3">
        {optional.map((s) => <StepCard key={s.key} step={s} done={!!status[s.key as keyof SetupStatus]} isNext={false} />)}
      </div>
    </div>
  );
}
