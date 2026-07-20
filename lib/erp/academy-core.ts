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

/**
 * TEMPORARY — the academy is hidden from tenants while the catalogue is still mostly
 * «قريباً». Only the platform owner (system_admin) can reach it, so the guides can be
 * written and reviewed against the real pages before customers see a half-empty
 * catalogue.
 *
 * **Flip this to `false` to release it — that is the whole switch.** It drives the
 * sidebar entry, the «اتعلّم» button inside every module, and the page guards, so
 * they cannot drift apart and leave a link pointing at a page that redirects.
 */
export const ACADEMY_ADMIN_ONLY = true;

/**
 * The capability the academy's nav entry and pages require while hidden.
 * `employee.manage` is system_admin-only (lib/rbac.ts MATRIX); undefined = everyone.
 */
export const ACADEMY_CAPABILITY = ACADEMY_ADMIN_ONLY ? "employee.manage" : undefined;

/**
 * Two separate catalogues. A lesson is a video شرح OR a written دليل — never both.
 *
 * A video and a guide on the same topic are two rows: different explanations at
 * different depths, for people who learn differently. Merging them into one row with
 * two fields made the video an afterthought hanging under the article.
 */
export const LESSON_KINDS = ["video", "doc"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export const KIND_LABELS: Record<LessonKind, string> = { video: "فيديو", doc: "دليل" };
export const KIND_ICONS: Record<LessonKind, string> = { video: "PlayCircle", doc: "FileText" };
/** Plural, for section headings and counts. */
export const KIND_PLURAL: Record<LessonKind, string> = { video: "شروحات فيديو", doc: "الأدلة المكتوبة" };

export const isLessonKind = (v: string): v is LessonKind => (LESSON_KINDS as readonly string[]).includes(v);

export type Lesson = {
  id: string;
  slug: string;
  title: string;
  module: ModuleKey;
  kind: LessonKind;
  outcome: string | null;
  /** kind=video: the YouTube link. */
  url: string | null;
  /** kind=doc: the guide (markdown, with screenshots). */
  body: string | null;
  minutes: number | null;
  level: "basic" | "advanced";
};

/**
 * Ready = the row's own content field is filled. A video needs a link; a guide needs
 * text. Checking the wrong field is how a lesson ends up listed as متاح and opening
 * onto nothing.
 *
 * The single definition of «متاح» — every count, badge and link routes through it.
 */
export const isLive = (l: Pick<Lesson, "kind" | "url" | "body">) =>
  l.kind === "video" ? !!l.url : !!l.body;

/**
 * A guide always opens in-app. A video opens in-app when we can embed it (YouTube);
 * anything else (Vimeo, Drive) goes to its own host, because for those our page would
 * be one outbound link and a wasted click.
 */
export const opensInApp = (l: Pick<Lesson, "kind" | "url" | "body">) =>
  l.kind === "doc" ? !!l.body : isEmbeddable(l.url);

export const lessonHref = (l: Lesson) =>
  opensInApp(l) ? `/academy/${l.module}/${l.slug}` : l.url;

export type Counts = { total: number; live: number; soon: number };

const count = (lessons: Lesson[]): Counts => {
  const live = lessons.filter(isLive).length;
  return { total: lessons.length, live, soon: lessons.length - live };
};

export const byKind = (lessons: Lesson[], kind: LessonKind) => lessons.filter((l) => l.kind === kind);

export type ModuleCard = {
  module: ModuleKey;
  label: string;
  icon: string;
  videos: Counts;
  docs: Counts;
} & Counts;

/**
 * The index: one card per module, in sidebar order, carrying both catalogues' counts
 * so the card can say «٣ فيديو · ٥ دليل» without a second query.
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
    return {
      module,
      label: MODULE_LABELS[module] ?? module,
      icon: MODULE_ICONS[module] ?? "GraduationCap",
      videos: count(byKind(mine, "video")),
      docs: count(byKind(mine, "doc")),
      ...count(mine),
    };
  });
}

export type AcademyProgress = Counts & { videos: Counts; docs: Counts };

export function progress(lessons: Lesson[]): AcademyProgress {
  return {
    ...count(lessons),
    videos: count(byKind(lessons, "video")),
    docs: count(byKind(lessons, "doc")),
  };
}

/** Whether a module key is one we actually have — guards the /erp/academy/[module] route. */
export function isModuleKey(v: string): v is ModuleKey {
  return (ALL_MODULES as readonly string[]).includes(v);
}

export { MODULE_ICONS };
