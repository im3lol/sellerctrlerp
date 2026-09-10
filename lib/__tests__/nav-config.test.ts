import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { NAV } from "@/components/app-shell/nav-config";

/**
 * The sidebar is the only map of the system, and it decays the way every map does:
 * one page at a time, each addition reasonable on its own. It reached 98 pages under
 * 21 sub-headers — four of them over a single page — with 25 labels too long to read
 * in a 256px column.
 *
 * These are the rules that cleanup applied. They live here rather than in a comment
 * because a comment doesn't fail.
 */

const items = NAV.flatMap((s) => s.items.map((i) => ({ ...i, module: s.heading ?? "—" })));

/**
 * Terms that lose their meaning when shortened. Every entry needs the reason, because
 * "it's a bit long but fine" is how the list got to 25.
 */
const LONG_LABELS_ALLOWED: Record<string, string> = {
  "كشف حساب العميل": "«كشف العميل» يقرأ كأنه بيانات العميل، مش حركة حسابه",
  "كشف حساب المورّد": "نفس السبب",
  "المطابقة البنكية": "مصطلح محاسبي قائم بذاته",
  "تكاليف الاستيراد": "«التكاليف» لوحدها تشمل كل حاجة",
  "الأرقام التسلسلية": "مفيش أقصر منه بيوصّل المعنى",
  "الأرصدة الافتتاحية": "خطوة ترحيل معروفة بالاسم ده",
  "الأصول الثابتة": "«الأصول» لوحدها تشمل المتداولة",
  "مطالبات المصروفات": "«المطالبات» لوحدها ملهاش معنى في الموارد البشرية",
  "توزيعات الأرباح": "«التوزيعات» غامضة",
  "عمولات المبيعات": "«العمولات» تتلخبط مع عمولة أمازون",
  "الفواتير الدورية": "«الدورية» لوحدها مش اسم",
  "مرتجعات المنصات": "«المرتجعات» موجودة في المبيعات بنفس الاسم",
  "تسويات المنصات": "«التسويات» موجودة في المخزون بنفس الاسم",
  "اقتراح أو شكوى": "جملة، مش اسم صفحة — مقصودة",
  "الموارد البشرية": "اسم موديول",
  "الصيانة والأسطول": "اسم موديول",
  "الإدارة والإعدادات": "اسم موديول",
};

describe("NAV", () => {
  it("a sub-header is worth a row only at three pages", () => {
    const undersized: string[] = [];
    for (const section of NAV) {
      const counts = new Map<string, number>();
      for (const i of section.items) if (i.group) counts.set(i.group, (counts.get(i.group) ?? 0) + 1);
      for (const [g, n] of counts) if (n < 3) undersized.push(`${section.heading} › ${g} (${n})`);
    }
    expect(undersized).toEqual([]);
  });

  it("no label is too long to read in a 256px sidebar", () => {
    const tooLong = items
      .filter((i) => i.label.length > 16 && !(i.label in LONG_LABELS_ALLOWED))
      .map((i) => `${i.module} › ${i.label} (${i.label.length})`);
    expect(tooLong).toEqual([]);
  });

  it("every allowed long label is still in the nav", () => {
    // Stops the exception list outliving the labels it excuses.
    const labels = new Set([...items.map((i) => i.label), ...NAV.map((s) => s.heading ?? "")]);
    expect(Object.keys(LONG_LABELS_ALLOWED).filter((l) => !labels.has(l))).toEqual([]);
  });

  it("no two pages in one module share a label", () => {
    const clashes: string[] = [];
    for (const section of NAV) {
      const seen = new Map<string, string>();
      for (const i of section.items) {
        const prev = seen.get(i.label);
        if (prev && prev !== i.href) clashes.push(`${section.heading} › ${i.label}`);
        seen.set(i.label, i.href);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("every href is a page that exists", () => {
    // Two pages are listed in two modules on purpose (a goods receipt is both a
    // purchase step and a warehouse operation), so dedupe before checking.
    const dead = [...new Set(items.map((i) => i.href))]
      .filter((h) => !h.includes("[") && !existsSync(`app/(app)${h}/page.tsx`));
    expect(dead).toEqual([]);
  });

  it("no module is longer than 20 rows", () => {
    const fat = NAV.filter((s) => s.items.length > 20).map((s) => `${s.heading} (${s.items.length})`);
    expect(fat).toEqual([]);
  });
});
