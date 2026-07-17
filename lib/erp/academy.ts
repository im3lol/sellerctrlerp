import { ALL_MODULES, MODULE_LABELS, type ModuleKey } from "@/lib/erp/module-list";

/**
 * الأكاديمية — the lesson catalogue.
 *
 * Deliberately a config file, not a table: these are lessons about *this product*,
 * identical for every tenant, so per-tenant rows and an admin screen to edit them
 * would be machinery with nothing to hold. They ship and version with the app. If
 * editing without a deploy ever matters, move it to /admin then — not before.
 *
 * A lesson with no `url` renders as قريباً. That is the point of listing it: an
 * empty slot is a visible promise, whereas an unlisted lesson is a gap nobody sees.
 * Fill the url in and it goes live — no other change needed.
 */
export type Lesson = {
  /** Stable slug — used as the anchor, so don't rename it once it ships. */
  id: string;
  title: string;
  /** What it teaches. Drives grouping AND the "اتعلّم" link inside that module. */
  module: ModuleKey;
  /** Absent = قريباً. */
  url?: string;
  minutes?: number;
  level?: "basic" | "advanced";
  /** One line: what the viewer can do afterwards. */
  outcome?: string;
};

/**
 * Ordered within each module: basics first. Cross-module lessons (e.g. the document
 * cycle) live with the module a user would look under, not in a "general" bucket
 * nobody opens.
 */
export const LESSONS: Lesson[] = [
  /* ── البداية: أول أسبوع ───────────────────────────────── */
  { id: "start-here", module: "accounting", level: "basic", minutes: 5,
    title: "ابدأ من هنا — جولة في النظام",
    outcome: "تعرف مكان كل موديول وإزاي تتنقّل بينهم." },
  { id: "chart-of-accounts", module: "accounting", level: "basic", minutes: 8,
    title: "دليل الحسابات — إعداده وتعديله",
    outcome: "تفهم شجرة الحسابات وتضيف حساباتك." },
  { id: "opening-balances", module: "accounting", level: "basic", minutes: 10,
    title: "الأرصدة الافتتاحية — ترحيل شركة قائمة",
    outcome: "تنقل أرصدة العملاء والموردين والمخزون والبنك من نظامك القديم." },
  { id: "journal-entries", module: "accounting", level: "basic", minutes: 7,
    title: "القيود اليومية والترحيل",
    outcome: "تكتب قيدًا وتفهم يعني إيه «مُرحّل» ويعني إيه «مسودة»." },
  { id: "fiscal-periods", module: "accounting", level: "advanced", minutes: 6,
    title: "الفترات المالية وإقفال السنة",
    outcome: "تقفل فترة وتمنع الترحيل عليها، وتعمل إقفال سنوي." },
  { id: "bank-reconciliation", module: "accounting", level: "advanced", minutes: 9,
    title: "المطابقة البنكية",
    outcome: "تطابق كشف البنك مع القيود وتكتشف الفروقات." },
  { id: "fixed-assets", module: "accounting", level: "advanced", minutes: 8,
    title: "الأصول الثابتة — الاقتناء والإهلاك والاستبعاد",
    outcome: "تسجّل أصلًا وتُرحّل إهلاكه الشهري وتستبعده بقيده الصحيح." },

  /* ── المبيعات ─────────────────────────────────────────── */
  { id: "sales-cycle", module: "sales", level: "basic", minutes: 10,
    title: "دورة البيع كاملة — من عرض السعر للتحصيل",
    outcome: "تمشي أمر بيع من العرض للتسليم للفاتورة لسند القبض." },
  { id: "customers", module: "sales", level: "basic", minutes: 5,
    title: "العملاء وحدود الائتمان",
    outcome: "تضيف عميلًا وتحدد له حد ائتمان يمنع تجاوزه." },
  { id: "sales-returns", module: "sales", level: "basic", minutes: 6,
    title: "مرتجعات البيع والإشعارات الدائنة",
    outcome: "ترجّع صنفًا وتفهم أثره على رصيد العميل والمخزون." },
  { id: "recurring-invoices", module: "sales", level: "advanced", minutes: 5,
    title: "الفواتير الدورية",
    outcome: "تفوتر اشتراكًا شهريًا تلقائيًا." },

  /* ── المشتريات ────────────────────────────────────────── */
  { id: "purchase-cycle", module: "purchases", level: "basic", minutes: 10,
    title: "دورة الشراء كاملة — من طلب المواد للسداد",
    outcome: "تمشي أمر شراء من الطلب للاستلام للفاتورة لسند الصرف." },
  { id: "grni", module: "purchases", level: "advanced", minutes: 7,
    title: "بضاعة مستلمة لم تُفوتر (GRNI)",
    outcome: "تفهم ليه الاستلام بيقيّد حساب وسيط وإزاي الفاتورة بتقفله." },
  { id: "landed-costs", module: "purchases", level: "advanced", minutes: 6,
    title: "التكاليف الإضافية على المشتريات",
    outcome: "توزّع الشحن والجمارك على تكلفة الأصناف." },

  /* ── المخزون ──────────────────────────────────────────── */
  { id: "items", module: "inventory", level: "basic", minutes: 8,
    title: "الأصناف والأكواد والباركود",
    outcome: "تضيف صنفًا بأكواده وتطبع له ملصق باركود." },
  { id: "stock-basics", module: "inventory", level: "basic", minutes: 7,
    title: "الأرصدة ودفتر حركة المخزون",
    outcome: "تقرأ رصيد أي صنف وتعرف كل حركة أثّرت فيه." },
  { id: "adjustments-transfers", module: "inventory", level: "basic", minutes: 6,
    title: "التسويات والتحويلات المخزنية",
    outcome: "تسوّي فرق جرد وتحوّل بضاعة بين مخزنين." },
  { id: "costing", module: "inventory", level: "advanced", minutes: 9,
    title: "تكلفة المخزون وتقييمه",
    outcome: "تفهم إزاي بتُحسب تكلفة البضاعة المباعة وتطابق قيمة المخزون مع المحاسبة." },
  { id: "batches-expiry", module: "inventory", level: "advanced", minutes: 6,
    title: "التشغيلات وتواريخ الصلاحية",
    outcome: "تتابع صلاحية البضاعة وتمنع بيع المنتهي." },

  /* ── المنصّات ─────────────────────────────────────────── */
  { id: "amazon-connect", module: "marketplace", level: "basic", minutes: 8,
    title: "ربط حساب أمازون",
    outcome: "تربط حساب البائع وتسحب المنتجات والأوردرات تلقائيًا." },
  { id: "marketplace-orders", module: "marketplace", level: "basic", minutes: 7,
    title: "أوردرات المنصّات ودورتها التلقائية",
    outcome: "تفهم إزاي الأوردر بيتحوّل لأمر بيع وفاتورة لوحده." },
  { id: "settlements", module: "marketplace", level: "advanced", minutes: 9,
    title: "تسويات أمازون والرسوم",
    outcome: "ترفع ملف التسوية وتفهم قيد الرسوم والتحصيل." },

  /* ── الموارد البشرية ──────────────────────────────────── */
  { id: "employees-payroll", module: "hr", level: "basic", minutes: 8,
    title: "الموظفون ومسير الرواتب",
    outcome: "تضيف موظفًا وتعمل مسير رواتب وتُرحّله." },
  { id: "leaves", module: "hr", level: "basic", minutes: 5,
    title: "الإجازات وتقويم العطلات",
    outcome: "تعتمد طلب إجازة وتضبط العطلات الرسمية." },

  /* ── المستثمرون ───────────────────────────────────────── */
  { id: "investors-capital", module: "investors", level: "basic", minutes: 7,
    title: "رأس المال ونسب الملكية",
    outcome: "تسجّل مساهمة مستثمر وتفهم إزاي بتُحسب نسبته." },
  { id: "profit-distribution", module: "investors", level: "advanced", minutes: 7,
    title: "توزيع الأرباح والسحوبات",
    outcome: "توزّع أرباح فترة على الشركاء وتصرفها لهم." },

  /* ── التقارير ─────────────────────────────────────────── */
  { id: "financial-statements", module: "reports", level: "basic", minutes: 10,
    title: "القوائم المالية — الدخل والمركز المالي",
    outcome: "تقرأ قائمة الدخل والميزانية وتعرف مصدر كل رقم." },
  { id: "aging", module: "reports", level: "basic", minutes: 6,
    title: "أعمار الديون والتحصيل",
    outcome: "تعرف مين متأخر عليك وبكام." },
  { id: "profitability", module: "reports", level: "advanced", minutes: 8,
    title: "ربحية المنتجات والتحليلات",
    outcome: "تعرف أنهي صنف بيكسب فعلًا بعد التكلفة." },
];

export type ModuleLessons = { module: ModuleKey; label: string; lessons: Lesson[] };

/**
 * Lessons grouped by module, in ALL_MODULES order so the page reads in the same
 * order as the sidebar. Modules with no lessons are dropped rather than shown empty.
 */
export function lessonsByModule(lessons: Lesson[] = LESSONS): ModuleLessons[] {
  return ALL_MODULES
    .map((module) => ({
      module,
      label: MODULE_LABELS[module] ?? module,
      lessons: lessons.filter((l) => l.module === module),
    }))
    .filter((g) => g.lessons.length > 0);
}

/** Lessons for one module — powers the «اتعلّم» link on each module overview. */
export function lessonsFor(module: ModuleKey, lessons: Lesson[] = LESSONS): Lesson[] {
  return lessons.filter((l) => l.module === module);
}

export type AcademyProgress = { total: number; live: number; soon: number };

export function progress(lessons: Lesson[] = LESSONS): AcademyProgress {
  const live = lessons.filter((l) => !!l.url).length;
  return { total: lessons.length, live, soon: lessons.length - live };
}
