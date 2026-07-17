import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { academyLessons } from "@/db/schema";
import { ALL_MODULES, MODULE_LABELS, MODULE_ICONS, type ModuleKey } from "@/lib/erp/module-list";

/**
 * الأكاديمية — lessons that teach the product, owned by the platform and edited from
 * /admin/academy.
 *
 * Not org-scoped anywhere in this file: see the note on the academy_lessons table.
 * These are lessons about SellerCtrl, the same for every tenant, so a global read is
 * correct here rather than a missing organizationId filter.
 */
export type Lesson = {
  id: string;
  slug: string;
  title: string;
  module: ModuleKey;
  outcome: string | null;
  /** Absent = قريباً. */
  url: string | null;
  minutes: number | null;
  level: "basic" | "advanced";
};

/** Lives in module-list.ts (client-safe — this file imports the db). Re-exported for callers already reading it here. */
export { MODULE_ICONS };

const row = (r: typeof academyLessons.$inferSelect): Lesson => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  module: r.module as ModuleKey,
  outcome: r.outcome,
  url: r.url,
  minutes: r.minutes,
  level: (r.level === "advanced" ? "advanced" : "basic"),
});

/** Active lessons, ordered as the owner arranged them. */
export async function listLessons(): Promise<Lesson[]> {
  const rows = await db.select().from(academyLessons)
    .where(eq(academyLessons.isActive, true))
    .orderBy(asc(academyLessons.module), asc(academyLessons.sortOrder), asc(academyLessons.title));
  return rows.map(row);
}

/** One module's lessons — the module index card and its page. */
export async function listLessonsFor(module: ModuleKey): Promise<Lesson[]> {
  const rows = await db.select().from(academyLessons)
    .where(and(eq(academyLessons.isActive, true), eq(academyLessons.module, module)))
    .orderBy(asc(academyLessons.sortOrder), asc(academyLessons.title));
  return rows.map(row);
}

/** Every lesson including hidden ones — the admin list. */
export async function listAllLessonsForAdmin() {
  return db.select().from(academyLessons)
    .orderBy(asc(academyLessons.module), asc(academyLessons.sortOrder), asc(academyLessons.title));
}

export type ModuleCard = {
  module: ModuleKey;
  label: string;
  icon: string;
  total: number;
  live: number;
  soon: number;
};

/**
 * The index: one card per module, in sidebar order.
 *
 * Pure so it can be tested without a database — a wrong module key doesn't crash,
 * the lesson just silently vanishes from its card, which is exactly the kind of
 * quiet failure worth pinning.
 *
 * Modules with no lessons are kept, not dropped: an empty card is the honest signal
 * that a module has nothing recorded yet. Hiding it hides the gap.
 */
export function moduleCards(lessons: Lesson[]): ModuleCard[] {
  return ALL_MODULES.map((module) => {
    const mine = lessons.filter((l) => l.module === module);
    const live = mine.filter((l) => !!l.url).length;
    return {
      module,
      label: MODULE_LABELS[module] ?? module,
      icon: MODULE_ICONS[module] ?? "GraduationCap",
      total: mine.length,
      live,
      soon: mine.length - live,
    };
  });
}

export type AcademyProgress = { total: number; live: number; soon: number };

export function progress(lessons: Lesson[]): AcademyProgress {
  const live = lessons.filter((l) => !!l.url).length;
  return { total: lessons.length, live, soon: lessons.length - live };
}

/** Whether a module key is one we actually have — guards the [module] route. */
export function isModuleKey(v: string): v is ModuleKey {
  return (ALL_MODULES as readonly string[]).includes(v);
}
