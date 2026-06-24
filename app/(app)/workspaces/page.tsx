import { eq } from "drizzle-orm";
import { getAccessibleWorkspaces } from "@/lib/workspaces";
import { getWorkspaceStats } from "@/lib/queries/workspace-stats";
import { requireCrm } from "@/lib/crm/guard";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { can } from "@/lib/rbac";
import { PageHeader } from "@/components/page-header";
import { WorkspaceCard } from "@/components/workspaces/workspace-card";
import { CreateWorkspaceDialog } from "@/components/workspaces/create-workspace-dialog";
import { EmptyState } from "@/components/empty-state";

export default async function WorkspacesPage() {
  const { user, orgId } = await requireCrm();
  const list = await getAccessibleWorkspaces(user, orgId);
  const stats = await getWorkspaceStats(list.map((w) => w.id));

  const clients = can(user.role, "workspace.create")
    ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.role, "client"))
    : [];

  return (
    <div>
      <PageHeader title="مساحات العمل" description="كل عميل أو متجر في مساحة عمل مستقلة">
        {can(user.role, "workspace.create") && <CreateWorkspaceDialog clients={clients} />}
      </PageHeader>

      {list.length === 0 ? (
        <EmptyState
          icon="Briefcase"
          title="لا توجد مساحات عمل"
          description="لم تتم إضافتك إلى أي مساحة عمل بعد."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((ws) => {
            const s = stats[ws.id];
            return (
              <WorkspaceCard
                key={ws.id}
                ws={ws}
                productCount={s.productCount}
                memberCount={s.memberCount}
                completion={s.completion}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
