import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { automationRules, automationRuns, orgSubscriptions, plans } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { ACTION_LABEL, DOCS, EVENT_LABEL, TEMPLATES, describeTrigger, isEvent, type RuleSpec } from "@/lib/erp/automation/model";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { AddTemplateButton, RuleDelete, RuleToggle } from "@/components/erp/automation-list";

export const dynamic = "force-dynamic";

const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const when = (d: Date) => new Date(d).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

export default async function AutomationPage() {
  return loadErpPage("automation.manage", async ({ orgId }) => {
    const rules = await db.select().from(automationRules)
      .where(eq(automationRules.organizationId, orgId)).orderBy(desc(automationRules.createdAt));
    const runs = await db.select({
      id: automationRuns.id, at: automationRuns.createdAt, status: automationRuns.status, entity: automationRuns.entityType,
      number: automationRuns.entityNumber, event: automationRuns.event, detail: automationRuns.detail, rule: automationRules.name,
    }).from(automationRuns).innerJoin(automationRules, eq(automationRules.id, automationRuns.ruleId))
      .where(eq(automationRuns.organizationId, orgId)).orderBy(desc(automationRuns.createdAt)).limit(30);
    const [plan] = await db.select({ max: plans.maxAutomations }).from(orgSubscriptions)
      .leftJoin(plans, eq(plans.id, orgSubscriptions.planId))
      .where(eq(orgSubscriptions.organizationId, orgId)).limit(1);
    const limit = plan?.max ?? null;
    const full = limit != null && rules.length >= limit;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Workflow" title="الأتمتة"
          subtitle="لما يحصل حدث على مستند، ولو شروطه اتحققت، السيستم ينفّذ اللي تحدده — لوحده"
          action={full ? undefined : (
            <Button asChild><Link href="/automation/new"><Icon name="Plus" className="size-4" />قاعدة جديدة</Link></Button>
          )} />

        <p className="text-sm text-muted-foreground">
          {limit == null ? `${int(rules.length)} قاعدة — من غير حد في باقتك.` : `${int(rules.length)} من ${int(limit)} قاعدة في باقتك.`}
          {full && " وصلت للحد — امسح قاعدة أو رقّي الباقة عشان تضيف تاني."}
        </p>

        {rules.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            لسه مفيش قواعد. ابدأ بوصفة جاهزة تحت، أو اعمل قاعدتك.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {rules.map((r) => {
              const spec = r.spec as RuleSpec;
              return (
                <Card key={r.id} className={r.enabled ? "" : "opacity-70"}>
                  <CardContent className="space-y-2 pt-5">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/automation/${r.id}`} className="font-medium hover:text-primary">{r.name}</Link>
                      <div className="flex shrink-0 items-center gap-1">
                        <RuleToggle id={r.id} enabled={r.enabled} />
                        <RuleDelete id={r.id} name={r.name} />
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {describeTrigger(spec.trigger)}
                      {spec.conditions.length > 0 && ` · ${int(spec.conditions.length)} شرط`}
                      {" ← "}{spec.actions.map((a) => ACTION_LABEL[a.type]).join("، ")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      اشتغلت {int(r.runCount)} مرة{r.lastRunAt ? ` · آخر مرة ${when(r.lastRunAt)}` : ""}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">وصفات جاهزة</CardTitle>
            <CardDescription>قواعد شائعة تتفعّل بضغطة، وتقدر تعدّلها بعدها.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((t) => (
              <div key={t.key} className="flex flex-col justify-between gap-3 rounded-xl border p-4">
                <div>
                  <div className="font-medium">{t.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                </div>
                {!full && <AddTemplateButton templateKey={t.key} needsSetup={t.spec.actions.some((a) => a.type === "webhook")} />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">آخر مرات التشغيل</CardTitle>
          </CardHeader>
          <CardContent>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">لسه مفيش قاعدة اشتغلت.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-start">الوقت</TableHead>
                      <TableHead className="text-start">القاعدة</TableHead>
                      <TableHead className="text-start">المستند</TableHead>
                      <TableHead className="text-start">اللي حصل</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((x) => {
                      const def = DOCS[x.entity];
                      return (
                        <TableRow key={x.id}>
                          <TableCell className="whitespace-nowrap text-xs">{when(x.at)}</TableCell>
                          <TableCell className="text-sm">{x.rule}</TableCell>
                          <TableCell className="text-sm">
                            {def && x.number
                              ? <Link href={`${def.path}/${encodeURIComponent(x.number)}`} className="text-primary hover:underline">{def.label} {x.number}</Link>
                              : `${def?.label ?? x.entity} ${x.number ?? ""}`}
                            <div className="text-xs text-muted-foreground">{isEvent(x.event) ? EVENT_LABEL[x.event] : x.event}</div>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Badge variant={x.status === "DONE" ? "outline" : "destructive"} className="mb-1">{x.status === "DONE" ? "تم" : "فيه فشل"}</Badge>
                            {(x.detail ?? []).map((l, i) => <div key={i}>{l}</div>)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  });
}
