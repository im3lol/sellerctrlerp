import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { getLesson, isModuleKey, opensInApp, KIND_LABELS, MODULE_ICONS } from "@/lib/erp/academy";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { youtubeId, youtubeEmbedUrl } from "@/lib/erp/youtube";
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
 * One lesson — a video شرح or a written دليل, whichever this row is.
 *
 * Only a video we can't embed skips this page (lessonHref sends it straight to its
 * host), since then the page really would be one outbound link.
 */
export default async function LessonPage({ params }: { params: Promise<{ module: string; slug: string }> }) {
  await requireUser();
  const { module, slug } = await params;
  if (!isModuleKey(module)) notFound();

  const lesson = await getLesson(slug);
  // 404 on a mismatched module too, not just a missing slug: otherwise every lesson
  // is reachable under all eight modules and the breadcrumb lies.
  if (!lesson || lesson.module !== module) notFound();
  // Nothing to show here — قريباً, or a video that only its own host can play.
  if (!opensInApp(lesson)) notFound();

  const videoId = lesson.kind === "video" ? youtubeId(lesson.url) : null;

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
        <Badge variant="outline">{KIND_LABELS[lesson.kind]}</Badge>
        <Badge variant="outline">{lesson.level === "basic" ? "أساسي" : "متقدّم"}</Badge>
        {lesson.minutes && (
          <span className="text-xs text-muted-foreground">
            {intf(lesson.minutes)} دقيقة {lesson.kind === "doc" ? "قراءة" : ""}
          </span>
        )}
      </div>

      {videoId && (
        <Card className="overflow-hidden">
          {/* 16:9 without an aspect-ratio dependency — the iframe fills the padded box. */}
          <div className="relative w-full bg-black" style={{ paddingTop: "56.25%" }}>
            <iframe
              className="absolute inset-0 size-full"
              src={youtubeEmbedUrl(videoId)}
              title={lesson.title}
              loading="lazy"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
        </Card>
      )}

      {/* A video we can't embed still deserves a way in. */}
      {lesson.kind === "video" && lesson.url && !videoId && (
        <a href={lesson.url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-3 rounded-xl border border-border p-4 transition-colors hover:bg-muted">
          <Icon name="PlayCircle" className="size-5 shrink-0 text-primary" />
          <div>
            <div className="text-sm font-medium">شغّل الفيديو</div>
            <div className="text-xs text-muted-foreground">هيفتح في تاب جديد</div>
          </div>
        </a>
      )}

      {lesson.body && (
        <Card>
          <CardContent className="pt-6"><DocBody body={lesson.body} /></CardContent>
        </Card>
      )}
    </div>
  );
}
