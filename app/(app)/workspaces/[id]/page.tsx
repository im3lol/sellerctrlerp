import Link from "next/link";
import { and, eq, ne, notInArray, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { getWorkspaceOr404, WORKSPACE_TYPE_LABELS } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { users, workspaceMembers, tasks, files } from "@/db/schema";
import { publicUrl } from "@/lib/storage";
import { FileManager } from "@/components/files/file-manager";
import {
  listProducts,
  listStatuses,
  workspaceAssignees,
} from "@/lib/queries/products";
import { getWorkspaceStats } from "@/lib/queries/workspace-stats";
import { listWorkspaceActivity } from "@/lib/queries/activity";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { WorkspaceTabBar } from "@/components/workspaces/workspace-tab-bar";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsFilters } from "@/components/products/products-filters";
import { ImportProductsDialog } from "@/components/products/import-products-dialog";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { MembersPanel } from "@/components/workspaces/members-panel";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/products/status-badge";

export default async function WorkspaceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab || "products";

  const ws = await getWorkspaceOr404(user, id);
  const canEdit = can(user.role, "product.edit");
  const canManage = can(user.role, "workspace.manage") || can(user.role, "task.manage");

  const [stats] = await Promise.all([getWorkspaceStats([id])]);
  const s = stats[id];

  return (
    <div>
      <PageHeader title={ws.name} description={ws.description ?? undefined}>
        <Badge variant="secondary">{WORKSPACE_TYPE_LABELS[ws.type]}</Badge>
      </PageHeader>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="المنتجات" value={s.productCount} icon="Package" tone="blue" />
        <StatCard label="مكتمل" value={s.completedCount} icon="CheckCircle2" tone="green" />
        <StatCard label="الأعضاء" value={s.memberCount} icon="Users" tone="slate" />
        <StatCard label="نسبة الإنجاز" value={`${s.completion}%`} icon="TrendingUp" tone="yellow" />
      </div>

      <WorkspaceTabBar active={tab} />

      {tab === "products" && (
        <ProductsTabContent
          workspaceId={id}
          filters={sp}
          canEdit={canEdit}
          canImport={can(user.role, "product.distribute")}
          canReview={can(user.role, "product.review")}
        />
      )}
      {tab === "team" && <TeamTabContent workspaceId={id} canManage={canManage} />}
      {tab === "tasks" && <TasksTabContent workspaceId={id} />}
      {tab === "files" && <FilesTabContent workspaceId={id} canEdit={canEdit} />}
      {tab === "activity" && <ActivityTabContent workspaceId={id} />}
    </div>
  );
}

async function ProductsTabContent({
  workspaceId,
  filters,
  canEdit,
  canImport,
  canReview,
}: {
  workspaceId: string;
  filters: Record<string, string>;
  canEdit: boolean;
  canImport: boolean;
  canReview: boolean;
}) {
  const [rows, statuses, assignees] = await Promise.all([
    listProducts({
      workspaceId,
      statusId: filters.statusId,
      assignedTo: filters.assignedTo,
      search: filters.search,
      draft: canReview ? "all" : "exclude",
    }),
    listStatuses(workspaceId),
    workspaceAssignees(workspaceId),
  ]);
  const statusOptions = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <ProductsFilters statuses={statusOptions} assignees={assignees} />
        {canImport && (
          <div className="flex items-center gap-2">
            <ProductFormDialog mode="create" workspaceId={workspaceId} statuses={statusOptions} assignees={assignees} />
            <ImportProductsDialog workspaceId={workspaceId} />
          </div>
        )}
      </div>
      <ProductsTable rows={rows} statuses={statusOptions} assignees={assignees} canEdit={canEdit} canReview={canReview} />
    </>
  );
}

async function TeamTabContent({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}) {
  const members = await db
    .select({
      userId: workspaceMembers.userId,
      memberRole: workspaceMembers.memberRole,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const memberIds = members.map((m) => m.userId);
  const candidates = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        ne(users.role, "client"),
        memberIds.length ? notInArray(users.id, memberIds) : undefined,
      ),
    );

  return (
    <MembersPanel
      workspaceId={workspaceId}
      members={members}
      candidates={candidates}
      canManage={canManage}
    />
  );
}

async function TasksTabContent({ workspaceId }: { workspaceId: string }) {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      assigneeName: users.name,
    })
    .from(tasks)
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(tasks.createdAt));

  if (rows.length === 0)
    return <EmptyState icon="ListChecks" title="لا توجد مهام" description="لم تُنشأ مهام لهذه المساحة بعد." />;

  const STATUS_AR: Record<string, string> = {
    new: "جديد",
    in_progress: "قيد التنفيذ",
    review: "مراجعة",
    done: "مكتمل",
    blocked: "متوقف",
  };

  return (
    <div className="divide-y rounded-2xl border bg-card">
      {rows.map((t) => (
        <Link
          key={t.id}
          href={`/tasks/${t.id}`}
          className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50"
        >
          <div>
            <p className="font-medium">{t.title}</p>
            <p className="text-xs text-muted-foreground">{t.assigneeName ?? "غير معيّن"}</p>
          </div>
          <StatusBadge name={STATUS_AR[t.status]} color="#0A33D1" />
        </Link>
      ))}
    </div>
  );
}

async function FilesTabContent({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const rows = await db
    .select({
      id: files.id,
      name: files.name,
      mime: files.mime,
      sizeBytes: files.sizeBytes,
      storageKey: files.storageKey,
      createdAt: files.createdAt,
      uploaderName: users.name,
    })
    .from(files)
    .leftJoin(users, eq(files.uploadedBy, users.id))
    .where(eq(files.workspaceId, workspaceId))
    .orderBy(desc(files.createdAt));

  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    mime: r.mime,
    sizeBytes: r.sizeBytes,
    url: publicUrl(r.storageKey),
    createdAt: r.createdAt,
    uploaderName: r.uploaderName,
  }));

  return <FileManager workspaceId={workspaceId} files={items} canManage={canEdit} />;
}

async function ActivityTabContent({ workspaceId }: { workspaceId: string }) {
  const items = await listWorkspaceActivity(workspaceId);
  return <ActivityFeed items={items} />;
}
