import Link from "next/link";
import { ne, eq, desc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { taskRecurrences, users, workspaces } from "@/db/schema";
import { getAccessibleWorkspaces } from "@/lib/workspaces";
import { requireCrm } from "@/lib/crm/guard";
import { orgWorkspaceIds } from "@/lib/crm/scope";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { List } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { CreateRecurrenceDialog } from "@/components/tasks/create-recurrence-dialog";
import { formatDateAr } from "@/lib/format";

const FREQ_AR: Record<string, string> = { daily: "يومياً", weekly: "أسبوعياً", monthly: "شهرياً" };

export default async function RecurringTasksPage() {
  const { user, orgId } = await requireCrm("task.manage");

  const [rows, wsList, assignees] = await Promise.all([
    db
      .select({
        id: taskRecurrences.id,
        title: taskRecurrences.title,
        frequency: taskRecurrences.frequency,
        nextRunAt: taskRecurrences.nextRunAt,
        assigneeName: users.name,
        workspaceName: workspaces.name,
      })
      .from(taskRecurrences)
      .leftJoin(users, eq(taskRecurrences.assigneeId, users.id))
      .leftJoin(workspaces, eq(taskRecurrences.workspaceId, workspaces.id))
      .where(inArray(taskRecurrences.workspaceId, orgWorkspaceIds(orgId)))
      .orderBy(desc(taskRecurrences.createdAt)),
    getAccessibleWorkspaces(user, orgId),
    db.select({ id: users.id, name: users.name }).from(users).where(ne(users.role, "client")),
  ]);

  return (
    <div>
      <PageHeader title="المهام المتكررة" description="مهام تُنشأ تلقائياً حسب جدول زمني">
        <Button variant="outline" asChild>
          <Link href="/tasks"><List className="size-4" />كل المهام</Link>
        </Button>
        <CreateRecurrenceDialog workspaces={wsList.map((w) => ({ id: w.id, name: w.name }))} assignees={assignees} />
      </PageHeader>

      {rows.length === 0 ? (
        <EmptyState icon="Repeat" title="لا توجد مهام متكررة" description="أنشئ مهمة متكررة لتوليدها تلقائياً." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id} className="gap-2 p-4">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{r.title}</p>
                <Badge variant="secondary">{FREQ_AR[r.frequency]}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {r.workspaceName ?? "—"} · {r.assigneeName ?? "غير معيّن"}
              </p>
              <p className="text-xs text-muted-foreground">التشغيل القادم: {formatDateAr(r.nextRunAt, true)}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
