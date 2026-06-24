import Link from "next/link";
import { List } from "lucide-react";
import { requireCrm } from "@/lib/crm/guard";
import { can } from "@/lib/rbac";
import { memberWorkspaceIds } from "@/lib/workspaces";
import { listTasks } from "@/lib/queries/tasks";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/tasks/kanban-board";
import { ProductProgress } from "@/components/products/product-progress";

export default async function KanbanPage() {
  const { user, orgId } = await requireCrm();
  const manager = can(user.role, "workspace.viewAll");
  const canEdit = can(user.role, "task.updateOwn");

  const tasks = await listTasks(
    manager ? { orgId } : { orgId, ownUserId: user.id, workspaceIds: await memberWorkspaceIds(user.id) },
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
      <ProductProgress userId={user.id} />
      <KanbanBoard tasks={tasks} canEdit={canEdit} />
    </div>
  );
}
