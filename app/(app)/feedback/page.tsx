import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { feedback } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ErpPageHeader } from "@/components/erp/page-header";
import { FeedbackForm } from "@/components/erp/feedback-form";
import { Icon } from "@/components/icon";

export const metadata = { title: "اقتراح أو شكوى" };

const fmt = (d: Date) => d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  open: { label: "مستلمة", variant: "secondary" },
  seen: { label: "بنشتغل عليها", variant: "outline" },
  done: { label: "تم", variant: "default" },
};

/**
 * اقتراح أو شكوى — the form, plus what this org sent before and what came back.
 *
 * The list is scoped to the active org and nothing else. A submission is tenant data:
 * one company must never read another's complaints.
 */
export default async function FeedbackPage() {
  const { user, org } = await getActiveOrg();
  if (!user) redirect("/login");
  if (!org) redirect("/dashboard");

  const mine = await withOrgScope(org.id, false, () => db.select().from(feedback)
    .where(eq(feedback.organizationId, org.id))
    .orderBy(desc(feedback.createdAt))
    .limit(50));

  return (
    <div className="mx-auto max-w-3xl space-y-6" dir="rtl">
      <ErpPageHeader icon="MessageSquarePlus" title="اقتراح أو شكوى"
        subtitle="قول لنا إيه اللي ناقص أو إيه اللي مضايقك — بنقرا كل حاجة" />

      <FeedbackForm />

      {mine.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground">اللي بعتّوه قبل كده</h2>
          {mine.map((f) => {
            const s = STATUS[f.status] ?? STATUS.open;
            return (
              <Card key={f.id}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon name={f.kind === "complaint" ? "TriangleAlert" : "Lightbulb"}
                        className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{f.subject}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.variant}>{s.label}</Badge>
                      <span className="text-xs text-muted-foreground">{fmt(f.createdAt)}</span>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">{f.message}</p>
                  {f.reply && (
                    <div className="rounded-lg border-r-2 border-primary bg-muted/50 p-3">
                      <div className="mb-1 text-xs font-medium text-primary">ردّنا</div>
                      <p className="whitespace-pre-wrap text-sm">{f.reply}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
