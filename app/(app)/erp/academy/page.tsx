import Link from "next/link";
import { requireUser } from "@/lib/session";
import { lessonsByModule, progress, type Lesson } from "@/lib/erp/academy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Icon } from "@/components/icon";
import { cn } from "@/lib/utils";

export const metadata = { title: "الأكاديمية" };

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

/**
 * الأكاديمية — how to use the system, grouped by the module each lesson explains.
 *
 * Grouped rather than a flat list on purpose: a flat list rots (forty links, half
 * broken, nobody able to see what's missing), while grouping keeps the page in the
 * sidebar's own order and makes a gap obvious. Lessons with no url show as قريباً —
 * a visible promise beats an invisible hole.
 *
 * No org guard: this is product documentation, not tenant data. Any signed-in user
 * can read it, including one whose org doesn't have that module — reading how the
 * inventory works is how someone decides to buy it.
 */
export default async function AcademyPage() {
  await requireUser();

  const groups = lessonsByModule();
  const p = progress();

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader icon="GraduationCap" title="الأكاديمية"
        subtitle="دروس قصيرة تشرح كل جزء في النظام — مرتّبة حسب الموديول" />

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 pt-6">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              كل درس بيقول لك تقدر تعمل إيه بعده. ابدأ بـ
              <Link href="#accounting" className="mx-1 text-primary underline">ابدأ من هنا</Link>
              لو أول مرة تدخل النظام.
            </p>
            <p className="text-xs text-muted-foreground">
              الدروس المعلَّمة «قريباً» بنسجّلها — لو محتاج واحد منها بسرعة قول لنا وهنقدّمه.
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums">{intf(p.live)}</div>
              <div className="text-xs text-muted-foreground">درس متاح</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold tabular-nums text-muted-foreground">{intf(p.soon)}</div>
              <div className="text-xs text-muted-foreground">قريباً</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {groups.map((g) => (
        // scroll-mt keeps the heading clear of the sticky topbar when linked to.
        <section key={g.module} id={g.module} className="scroll-mt-20">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{g.label}</CardTitle>
              <CardDescription>{intf(g.lessons.length)} درس</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-2">
                {g.lessons.map((l) => <LessonCard key={l.id} lesson={l} />)}
              </div>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}

function LessonCard({ lesson }: { lesson: Lesson }) {
  const live = !!lesson.url;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon name={live ? "PlayCircle" : "Clock"} className={cn("size-4 shrink-0", live ? "text-primary" : "text-muted-foreground")} />
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

  // A لسه-مش-جاهز lesson is deliberately not a link — a dead click teaches the user
  // the page lies, and they stop trusting the ones that do work.
  return live ? (
    <a href={lesson.url} target="_blank" rel="noopener noreferrer" className={className}>{body}</a>
  ) : (
    <div className={className}>{body}</div>
  );
}
