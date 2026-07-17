import { ALL_MODULES, MODULE_LABELS, MODULE_ICONS, type ModuleKey } from "@/lib/erp/module-list";
import { isEmbeddable } from "@/lib/erp/youtube";

/**
 * الأكاديمية — the lesson rules. Pure: no db import, so client components (the admin
 * editor) and tests can use it.
 *
 * The queries live in academy.ts, which imports the db and re-exports everything here.
 * Reaching for academy.ts from a client component pulls `pg` into the browser bundle
 * and the build dies on "Can't resolve 'dns'" — same split as module-list.ts.
 */
export type Lesson = {
  id: string;
  slug: string;
  title: string;
  module: ModuleKey;
  outcome: string | null;
  /** YouTube link — plays embedded in the lesson page. */
  url: string | null;
  /** Written article (markdown) — renders in the same page. */
  body: string | null;
  minutes: number | null;
  level: "basic" | "advanced";
};

/**
 * A lesson is ready once it has a video or an article.
 *
 * The single definition of «متاح» — every count, badge and link routes through it, so
 * a lesson can never read متاح on one page and قريباً on another.
 */
export const isLive = (l: Pick<Lesson, "url" | "body">) => !!l.url || !!l.body;

/**
 * Video and article are equal formats — a lesson can be either or both, and the page
 * plays the video AND shows the article. Neither hangs off the other.
 */
export type LessonFormat = "video" | "doc" | "both" | "soon";

export function lessonFormat(l: Pick<Lesson, "url" | "body">): LessonFormat {
  if (l.url && l.body) return "both";
  if (l.url) return "video";
  if (l.body) return "doc";
  return "soon";
}

export const FORMAT_LABELS: Record<LessonFormat, string> = {
  video: "فيديو",
  doc: "مقال",
  both: "فيديو + مقال",
  soon: "قريباً",
};

/**
 * Where a lesson opens.
 *
 * In-app whenever we can actually show something there: a YouTube video plays
 * embedded, an article renders. Only a video we cannot embed (Vimeo, Drive, a bare
 * file) links straight out — for that one the page really would be a single outbound
 * link, and a wasted click.
 */
export const lessonHref = (l: Lesson) =>
  l.body || isEmbeddable(l.url) ? `/erp/academy/${l.module}/${l.slug}` : l.url;

/** Whether the lesson opens inside the app (vs. jumping to the video's own host). */
export const opensInApp = (l: Pick<Lesson, "url" | "body">) => !!l.body || isEmbeddable(l.url);

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
 * A wrong module key doesn't crash — the lesson just silently vanishes from its card,
 * which is exactly the kind of quiet failure worth pinning in a test.
 *
 * Modules with no lessons are kept, not dropped: an empty card is the honest signal
 * that a module has nothing recorded yet. Hiding it hides the gap.
 */
export function moduleCards(lessons: Lesson[]): ModuleCard[] {
  return ALL_MODULES.map((module) => {
    const mine = lessons.filter((l) => l.module === module);
    const live = mine.filter(isLive).length;
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
  const live = lessons.filter(isLive).length;
  return { total: lessons.length, live, soon: lessons.length - live };
}

/** Whether a module key is one we actually have — guards the [module] route. */
export function isModuleKey(v: string): v is ModuleKey {
  return (ALL_MODULES as readonly string[]).includes(v);
}

export { MODULE_ICONS };
