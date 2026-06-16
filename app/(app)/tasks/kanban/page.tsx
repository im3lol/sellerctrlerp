import Link from "next/link";
import { List } from "lucide-react";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { memberWorkspaceIds } from "@/lib/workspaces";
import { listTasks } from "@/lib/queries/tasks";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/tasks/kanban-board";

export default async function KanbanPage() {
  const user = await requireUser();
  const manager = can(user.role, "workspace.viewAll");
  const canEdit = can(user.role, "task.updateOwn");

  const tasks = await listTasks(
    manager ? {} : { ownUserId: user.id, workspaceIds: await memberWorkspaceIds(user.id) },
  );

  return (
    <div>
      <PageHeader title="لوحة كانبان" description="اسحب المهام بين الأعمدة لتحديث حالتها">
        <Button variant="outline" asChild>
          <Link href="/tasks">
            <List className="size-4" />
            عرض القائمة
          </Link>
        </Button>
      </PageHeader>
      <KanbanBoard tasks={tasks} canEdit={canEdit} />
    </div>
  );
}
