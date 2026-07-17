import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  isModuleKey, listLessonsFor, progress, isLive, lessonHref, opensInApp, byKind,
  KIND_PLURAL, KIND_ICONS, LESSON_KINDS, MODULE_ICONS, type Lesson, type LessonKind,
} from "@/lib/erp/academy";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const label = MODULE_LABELS[module];
  return { title: label ? `الأكاديمية — ${label}` : "الأكاديمية" };
}

/**
 * One module — videos and guides as two separate lists.
 *
 * Separate, not interleaved: someone arrives wanting to watch or wanting to read, and
 * a mixed list makes them filter it in their head.
 */
export default async function AcademyModulePage({ params }: { params: Promise<{ module: string }> }) {
  await requireUser();
  const { module } = await params;
  // The route is user-supplied; anything that isn't a real module key is a 404 rather
  // than an empty page pretending the module exists.
  if (!isModuleKey(module)) notFound();

  const lessons = await listLessonsFor(module);
  const p = progress(lessons);

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon={MODULE_ICONS[module] ?? "GraduationCap"}
        title={`الأكاديمية — ${MODULE_LABELS[module] ?? module}`}
        subtitle={lessons.length === 0
          ? "لا توجد دروس بعد"
          : `${intf(p.videos.live)} فيديو · ${intf(p.docs.live)} دليل · ${intf(p.soon)} قريباً`}
        backHref="/erp/academy"
      />

      {lessons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            لسه مافيش دروس للموديول ده — بنجهّزها.
          </CardContent>
        </Card>
      ) : (
        LESSON_KINDS.map((kind) => (
          <Section key={kind} kind={kind} lessons={byKind(lessons, kind)} />
        ))
      )}
    </div>
  );
}

function Section({ kind, lessons }: { kind: LessonKind; lessons: Lesson[] }) {
  // An empty catalogue keeps its heading: «لا توجد أدلة» is information, a missing
  // section just looks like the feature doesn't exist.
  const live = lessons.filter(isLive).length;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon name={KIND_ICONS[kind]} className="size-[18px] text-muted-foreground" />
        <h2 className="font-semibold">{KIND_PLURAL[kind]}</h2>
        <span className="text-xs text-muted-foreground">
          {lessons.length === 0 ? "لا يوجد بعد" : `${intf(live)} متاح · ${intf(lessons.length - live)} قريباً`}
        </span>
      </div>

      {lessons.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          {kind === "video" ? "لسه مافيش فيديوهات هنا." : "لسه مافيش أدلة مكتوبة هنا."}
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lessons.map((l) => <LessonCard key={l.id} lesson={l} />)}
        </div>
      )}
    </section>
  );
}

function LessonCard({ lesson }: { lesson: Lesson }) {
  const live = isLive(lesson);
  const href = lessonHref(lesson);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name={live ? KIND_ICONS[lesson.kind] : "Clock"}
            className={cn("size-4 shrink-0", live ? "text-primary" : "text-muted-foreground")} />
          <span className="font-medium">{lesson.title}</span>
        </div>
        {!live && <Badge variant="secondary" className="shrink-0">قريباً</Badge>}
      </div>
      {lesson.outcome && <p className="pr-6 text-sm text-muted-foreground">{lesson.outcome}</p>}
      <div className="flex gap-2 pr-6 text-xs text-muted-foreground">
        {lesson.minutes && <span>{intf(lesson.minutes)} دقيقة</span>}
        {lesson.level && <span>· {lesson.level === "basic" ? "أساسي" : "متقدّم"}</span>}
      </div>
    </>
  );

  const className = cn(
    "flex flex-col gap-1 rounded-lg border border-border p-3 transition-colors",
    live ? "hover:bg-muted" : "opacity-70",
  );

  // A قريباً lesson is deliberately not a link: a dead click teaches the user the
  // page lies, and then they stop trusting the ones that do work.
  if (!live || !href) return <div className={className}>{body}</div>;

  return opensInApp(lesson)
    ? <Link href={href} className={className}>{body}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>;
}
