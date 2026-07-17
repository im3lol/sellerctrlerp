import { db } from "@/lib/db";
import { academyLessons } from "@/db/schema";

/**
 * Seeds the academy syllabus: the lesson list, all without urls, so the catalogue
 * arrives as a plan rather than an empty table.
 *
 * Idempotent — onConflictDoNothing on the slug — so it can be re-run after adding
 * new rows here without touching whatever the owner has edited in /admin/academy.
 * Titles/urls are theirs to change; this only ever inserts what's missing.
 *
 * Run: npx tsx db/seed-academy.ts
 */
const L = (
  slug: string, module: string, title: string, outcome: string,
  minutes: number, level: "basic" | "advanced", sortOrder: number,
) => ({ slug, module, title, outcome, minutes, level, sortOrder });

export const SYLLABUS = [
  /* المحاسبة */
  L("start-here", "accounting", "ابدأ من هنا — جولة في النظام", "تعرف مكان كل موديول وإزاي تتنقّل بينهم.", 5, "basic", 1),
  L("chart-of-accounts", "accounting", "دليل الحسابات — إعداده وتعديله", "تفهم شجرة الحسابات وتضيف حساباتك.", 8, "basic", 2),
  L("opening-balances", "accounting", "الأرصدة الافتتاحية — ترحيل شركة قائمة", "تنقل أرصدة العملاء والموردين والمخزون والبنك من نظامك القديم.", 10, "basic", 3),
  L("journal-entries", "accounting", "القيود اليومية والترحيل", "تكتب قيدًا وتفهم يعني إيه «مُرحّل» ويعني إيه «مسودة».", 7, "basic", 4),
  L("fiscal-periods", "accounting", "الفترات المالية وإقفال السنة", "تقفل فترة وتمنع الترحيل عليها، وتعمل إقفال سنوي.", 6, "advanced", 5),
  L("bank-reconciliation", "accounting", "المطابقة البنكية", "تطابق كشف البنك مع القيود وتكتشف الفروقات.", 9, "advanced", 6),
  L("fixed-assets", "accounting", "الأصول الثابتة — الاقتناء والإهلاك والاستبعاد", "تسجّل أصلًا وتُرحّل إهلاكه الشهري وتستبعده بقيده الصحيح.", 8, "advanced", 7),

  /* المبيعات */
  L("sales-cycle", "sales", "دورة البيع كاملة — من عرض السعر للتحصيل", "تمشي أمر بيع من العرض للتسليم للفاتورة لسند القبض.", 10, "basic", 1),
  L("customers", "sales", "العملاء وحدود الائتمان", "تضيف عميلًا وتحدد له حد ائتمان يمنع تجاوزه.", 5, "basic", 2),
  L("sales-returns", "sales", "مرتجعات البيع والإشعارات الدائنة", "ترجّع صنفًا وتفهم أثره على رصيد العميل والمخزون.", 6, "basic", 3),
  L("recurring-invoices", "sales", "الفواتير الدورية", "تفوتر اشتراكًا شهريًا تلقائيًا.", 5, "advanced", 4),

  /* المشتريات */
  L("purchase-cycle", "purchases", "دورة الشراء كاملة — من طلب المواد للسداد", "تمشي أمر شراء من الطلب للاستلام للفاتورة لسند الصرف.", 10, "basic", 1),
  L("grni", "purchases", "بضاعة مستلمة لم تُفوتر (GRNI)", "تفهم ليه الاستلام بيقيّد حساب وسيط وإزاي الفاتورة بتقفله.", 7, "advanced", 2),
  L("landed-costs", "purchases", "التكاليف الإضافية على المشتريات", "توزّع الشحن والجمارك على تكلفة الأصناف.", 6, "advanced", 3),

  /* المخزون */
  L("items", "inventory", "الأصناف والأكواد والباركود", "تضيف صنفًا بأكواده وتطبع له ملصق باركود.", 8, "basic", 1),
  L("stock-basics", "inventory", "الأرصدة ودفتر حركة المخزون", "تقرأ رصيد أي صنف وتعرف كل حركة أثّرت فيه.", 7, "basic", 2),
  L("adjustments-transfers", "inventory", "التسويات والتحويلات المخزنية", "تسوّي فرق جرد وتحوّل بضاعة بين مخزنين.", 6, "basic", 3),
  L("costing", "inventory", "تكلفة المخزون وتقييمه", "تفهم إزاي بتُحسب تكلفة البضاعة المباعة وتطابق قيمة المخزون مع المحاسبة.", 9, "advanced", 4),
  L("batches-expiry", "inventory", "التشغيلات وتواريخ الصلاحية", "تتابع صلاحية البضاعة وتمنع بيع المنتهي.", 6, "advanced", 5),

  /* المنصّات */
  L("amazon-connect", "marketplace", "ربط حساب أمازون", "تربط حساب البائع وتسحب المنتجات والأوردرات تلقائيًا.", 8, "basic", 1),
  L("marketplace-orders", "marketplace", "أوردرات المنصّات ودورتها التلقائية", "تفهم إزاي الأوردر بيتحوّل لأمر بيع وفاتورة لوحده.", 7, "basic", 2),
  L("settlements", "marketplace", "تسويات أمازون والرسوم", "ترفع ملف التسوية وتفهم قيد الرسوم والتحصيل.", 9, "advanced", 3),

  /* الموارد البشرية */
  L("employees-payroll", "hr", "الموظفون ومسير الرواتب", "تضيف موظفًا وتعمل مسير رواتب وتُرحّله.", 8, "basic", 1),
  L("leaves", "hr", "الإجازات وتقويم العطلات", "تعتمد طلب إجازة وتضبط العطلات الرسمية.", 5, "basic", 2),

  /* المستثمرون */
  L("investors-capital", "investors", "رأس المال ونسب الملكية", "تسجّل مساهمة مستثمر وتفهم إزاي بتُحسب نسبته.", 7, "basic", 1),
  L("profit-distribution", "investors", "توزيع الأرباح والسحوبات", "توزّع أرباح فترة على الشركاء وتصرفها لهم.", 7, "advanced", 2),

  /* التقارير */
  L("financial-statements", "reports", "القوائم المالية — الدخل والمركز المالي", "تقرأ قائمة الدخل والميزانية وتعرف مصدر كل رقم.", 10, "basic", 1),
  L("aging", "reports", "أعمار الديون والتحصيل", "تعرف مين متأخر عليك وبكام.", 6, "basic", 2),
  L("profitability", "reports", "ربحية المنتجات والتحليلات", "تعرف أنهي صنف بيكسب فعلًا بعد التكلفة.", 8, "advanced", 3),
];

export async function seedAcademy() {
  const res = await db.insert(academyLessons).values(SYLLABUS).onConflictDoNothing({ target: academyLessons.slug })
    .returning({ slug: academyLessons.slug });
  return res.length;
}

if (require.main === module) {
  seedAcademy()
    .then((n) => { console.log(`✅ academy: ${n} lesson(s) inserted (existing rows untouched)`); process.exit(0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
