import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { isModuleKey, listLessonsFor, progress, isLive, lessonHref, opensInApp, lessonFormat, FORMAT_LABELS, MODULE_ICONS, type Lesson } from "@/lib/erp/academy";
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

/** One module's lessons. Reached from the academy index or «اتعلّم» inside the module. */
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
        subtitle={lessons.length === 0 ? "لا توجد دروس بعد" : `${intf(p.live)} متاح · ${intf(p.soon)} قريباً`}
        backHref="/erp/academy"
      />

      {lessons.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            لسه مافيش دروس للموديول ده — بنسجّلها.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lessons.map((l) => <LessonCard key={l.id} lesson={l} />)}
        </div>
      )}
    </div>
  );
}

/** Video and article are peers, so each gets its own icon and neither outranks the other. */
const FORMAT_ICONS: Record<string, string> = {
  video: "PlayCircle",
  doc: "FileText",
  both: "MonitorPlay",
  soon: "Clock",
};

function LessonCard({ lesson }: { lesson: Lesson }) {
  const live = isLive(lesson);
  const href = lessonHref(lesson);
  const format = lessonFormat(lesson);

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name={FORMAT_ICONS[format]} className={cn("size-4 shrink-0", live ? "text-primary" : "text-muted-foreground")} />
          <span className="font-medium">{lesson.title}</span>
        </div>
        {!live && <Badge variant="secondary" className="shrink-0">قريباً</Badge>}
      </div>
      {lesson.outcome && <p className="pr-6 text-sm text-muted-foreground">{lesson.outcome}</p>}
      <div className="flex gap-2 pr-6 text-xs text-muted-foreground">
        {/* Say the format before the click — someone looking to read shouldn't land on a video. */}
        {live && <span>{FORMAT_LABELS[format]}</span>}
        {lesson.minutes && <span>· {intf(lesson.minutes)} دقيقة</span>}
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

  // Opens in-app whenever we can play or render it here; only a video we can't embed
  // leaves for its own host.
  return opensInApp(lesson)
    ? <Link href={href} className={className}>{body}</Link>
    : <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>;
}
