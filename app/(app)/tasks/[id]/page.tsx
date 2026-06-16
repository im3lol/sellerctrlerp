import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { canAccessWorkspace } from "@/lib/workspaces";
import { getTaskDetail, TASK_STATUS_AR } from "@/lib/queries/tasks";
import { listEntityActivity } from "@/lib/queries/activity";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PriorityBadge } from "@/components/tasks/priority-badge";
import { TaskStatusSelect } from "@/components/tasks/task-status-select";
import { DeleteTaskButton } from "@/components/tasks/delete-task-button";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { CommentsSection } from "@/components/comments/comments-section";
import { formatDateAr } from "@/lib/format";

export default async function TaskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getTaskDetail(id);
  if (!detail) notFound();
  const t = detail.task;

  const manager = can(user.role, "workspace.viewAll");
  const isAssignee = t.assigneeId === user.id;
  const hasWsAccess = t.workspaceId ? await canAccessWorkspace(user, t.workspaceId) : false;
  if (!manager && !isAssignee && !hasWsAccess) notFound();

  const canEdit = can(user.role, "task.updateOwn") && (manager || isAssignee || hasWsAccess);
  const canManage = can(user.role, "task.manage");
  const history = await listEntityActivity("task", id);
  const init = (t.assigneeId ? detail.assigneeName ?? "؟" : "؟").split(" ").slice(0, 2).map((p) => p[0]).join("");

  return (
    <div>
      <nav className="mb-4 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/tasks" className="hover:text-foreground">المهام</Link>
        <ChevronRight className="size-4 rotate-180" />
        <span className="text-foreground">{t.title}</span>
      </nav>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-6">
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-xl font-bold">{t.title}</h1>
              {canManage && <DeleteTaskButton taskId={id} />}
            </div>
            {t.description && (
              <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{t.description}</p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">التعليقات</h2>
            <CommentsSection entityType="task" entityId={id} />
          </Card>

          <Card className="p-6">
            <h2 className="mb-3 font-semibold">السجل</h2>
            <ActivityFeed items={history} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-5">
            <div className="space-y-1.5">
              <p className="text-sm text-muted-foreground">الحالة</p>
              <TaskStatusSelect taskId={id} status={t.status} disabled={!canEdit} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">الأولوية</span>
              <PriorityBadge priority={t.priority} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">المسؤول</span>
              {detail.assigneeName ? (
                <span className="flex items-center gap-2 text-sm">
                  <Avatar className="size-6">
                    {detail.assigneeAvatar && <AvatarImage src={detail.assigneeAvatar} />}
                    <AvatarFallback className="bg-primary/10 text-[10px] text-primary">{init}</AvatarFallback>
                  </Avatar>
                  {detail.assigneeName}
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">غير معيّن</span>
              )}
            </div>
            {detail.workspaceName && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">مساحة العمل</span>
                <Link href={`/workspaces/${t.workspaceId}`} className="text-sm text-primary hover:underline">
                  {detail.workspaceName}
                </Link>
              </div>
            )}
            {t.dueDate && (
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">الموعد النهائي</span>
                <span className="text-sm">{formatDateAr(t.dueDate)}</span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
