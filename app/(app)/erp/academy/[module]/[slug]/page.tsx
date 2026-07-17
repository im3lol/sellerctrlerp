import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getLesson, isModuleKey, MODULE_ICONS } from "@/lib/erp/academy";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { DocBody } from "@/components/erp/doc-body";
import { Icon } from "@/components/icon";

const intf = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lesson = await getLesson(slug);
  return { title: lesson ? `الأكاديمية — ${lesson.title}` : "الأكاديمية" };
}

/**
 * A written lesson. Reached only when the lesson has a body — a video-only lesson
 * links straight out, since a page whose whole content is one link is a wasted click.
 */
export default async function LessonPage({ params }: { params: Promise<{ module: string; slug: string }> }) {
  await requireUser();
  const { module, slug } = await params;
  if (!isModuleKey(module)) notFound();

  const lesson = await getLesson(slug);
  // 404 on a mismatched module too, not just a missing slug: otherwise every lesson
  // is reachable under all eight modules and the breadcrumb lies.
  if (!lesson || !lesson.body || lesson.module !== module) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir="rtl">
      <ErpPageHeader
        icon={MODULE_ICONS[module] ?? "GraduationCap"}
        title={lesson.title}
        subtitle={lesson.outcome ?? MODULE_LABELS[module]}
        backHref={`/erp/academy/${module}`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{MODULE_LABELS[module]}</Badge>
        <Badge variant="outline">{lesson.level === "basic" ? "أساسي" : "متقدّم"}</Badge>
        {lesson.minutes && (
          <span className="text-xs text-muted-foreground">{intf(lesson.minutes)} دقيقة قراءة</span>
        )}
      </div>

      {lesson.url && (
        // Both formats: the same lesson, watched or read. Whichever the reader prefers.
        <a href={lesson.url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted">
          <Icon name="PlayCircle" className="size-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-medium">اتفرّج على الدرس بدل ما تقراه</div>
            <div className="text-xs text-muted-foreground">نفس المحتوى فيديو</div>
          </div>
        </a>
      )}

      <Card>
        <CardContent className="pt-6"><DocBody body={lesson.body} /></CardContent>
      </Card>
    </div>
  );
}
