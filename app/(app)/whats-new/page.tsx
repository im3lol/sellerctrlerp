import { requireUser } from "@/lib/session";
import { listChangelog, KIND_LABELS, type ChangelogEntry } from "@/lib/erp/changelog";
import { MODULE_LABELS } from "@/lib/erp/module-list";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { DocBody } from "@/components/erp/doc-body";
import { cn } from "@/lib/utils";

export const metadata = { title: "آخر التحديثات" };

const fmt = (d: Date) =>
  d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

const KIND_STYLE: Record<string, string> = {
  feature: "bg-primary/10 text-primary",
  improvement: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  fix: "bg-amber-500/10 text-amber-600 dark:text-amber-500",
};

/**
 * آخر التحديثات — what shipped, newest first.
 *
 * No capability gate, same as the academy: release notes are product information,
 * not tenant data.
 */
export default async function WhatsNewPage() {
  await requireUser();
  const entries = await listChangelog();

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir="rtl">
      <ErpPageHeader icon="Sparkles" title="آخر التحديثات"
        subtitle="كل حاجة جديدة في النظام — الأحدث الأول" />

      {entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            لسه مافيش تحديثات منشورة.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((e) => <Entry key={e.id} entry={e} />)}
        </div>
      )}
    </div>
  );
}

function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", KIND_STYLE[entry.kind])}>
            {KIND_LABELS[entry.kind]}
          </span>
          {entry.module && <Badge variant="outline">{MODULE_LABELS[entry.module] ?? entry.module}</Badge>}
          <span className="text-xs text-muted-foreground">{fmt(entry.releasedAt)}</span>
        </div>
        <h2 className="text-lg font-semibold">{entry.title}</h2>
        <DocBody body={entry.body} />
      </CardContent>
    </Card>
  );
}
