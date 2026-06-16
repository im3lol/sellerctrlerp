import Link from "next/link";
import { ne, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { memberWorkspaceIds, getAccessibleWorkspaces } from "@/lib/workspaces";
import { listTasks, TASK_STATUS_AR } from "@/lib/queries/tasks";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { StatusBadge } from "@/components/products/status-badge";
import { CreateTaskDialog } from "@/components/tasks/create-task-dialog";
import { EmptyState } from "@/components/empty-state";
import { Columns3 } from "lucide-react";
import { formatDateAr } from "@/lib/format";

export default async function TasksPage() {
  const user = await requireUser();
  const manager = can(user.role, "workspace.viewAll");
  const canManage = can(user.role, "task.manage");

  const tasks = await listTasks(
    manager ? {} : { ownUserId: user.id, workspaceIds: await memberWorkspaceIds(user.id) },
  );

  const [wsList, assignees] = await Promise.all([
    getAccessibleWorkspaces(user),
    db.select({ id: users.id, name: users.name }).from(users).where(ne(users.role, "client")),
  ]);

  return (
    <div>
      <PageHeader title="المهام" description={`${tasks.length} مهمة`}>
        <Button variant="outline" asChild>
          <Link href="/tasks/kanban">
            <Columns3 className="size-4" />
            عرض كانبان
          </Link>
        </Button>
        {canManage && (
          <CreateTaskDialog
            workspaces={wsList.map((w) => ({ id: w.id, name: w.name }))}
            assignees={assignees}
          />
        )}
      </PageHeader>

      {tasks.length === 0 ? (
        <EmptyState icon="ListChecks" title="لا توجد مهام" />
      ) : (
        <div className="divide-y rounded-2xl border bg-card">
          {tasks.map((t) => {
            const init = (t.assigneeName ?? "؟").split(" ").slice(0, 2).map((p) => p[0]).join("");
            return (
              <Link
                key={t.id}
                href={`/tasks/${t.id}`}
                className="flex items-center gap-3 p-4 hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.workspaceName ?? "—"}
                    {t.dueDate && ` · ${formatDateAr(t.dueDate)}`}
                  </p>
                </div>
                <PriorityBadge priority={t.priority} />
                <StatusBadge name={TASK_STATUS_AR[t.status]} color="#0A33D1" />
                {t.assigneeName && (
                  <Avatar className="size-7">
                    {t.assigneeAvatar && <AvatarImage src={t.assigneeAvatar} />}
                    <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{init}</AvatarFallback>
                  </Avatar>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
