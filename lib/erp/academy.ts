import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { academyLessons } from "@/db/schema";
import { type ModuleKey } from "@/lib/erp/module-list";
import { type Lesson } from "@/lib/erp/academy-core";

/**
 * الأكاديمية — lesson queries. Server-only: it imports the db.
 *
 * The rules (isLive, lessonFormat, lessonHref, moduleCards…) live in academy-core.ts
 * and are re-exported below, so server callers keep one import while client components
 * can reach for academy-core directly without dragging `pg` into the browser bundle.
 *
 * Not org-scoped anywhere in this file: see the note on the academy_lessons table.
 * These are lessons about SellerCtrl, the same for every tenant, so a global read is
 * correct here rather than a missing organizationId filter.
 */
export * from "@/lib/erp/academy-core";

const row = (r: typeof academyLessons.$inferSelect): Lesson => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  module: r.module as ModuleKey,
  outcome: r.outcome,
  url: r.url,
  body: r.body,
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

/** One lesson by its slug — the lesson page. Active only; a hidden lesson 404s. */
export async function getLesson(slug: string): Promise<Lesson | null> {
  const [r] = await db.select().from(academyLessons)
    .where(and(eq(academyLessons.slug, slug), eq(academyLessons.isActive, true)))
    .limit(1);
  return r ? row(r) : null;
}

/** Every lesson including hidden ones — the admin list. */
export async function listAllLessonsForAdmin() {
  return db.select().from(academyLessons)
    .orderBy(asc(academyLessons.module), asc(academyLessons.sortOrder), asc(academyLessons.title));
}
