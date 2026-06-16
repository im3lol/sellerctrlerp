import { and, eq, isNull, sql } from "drizzle-orm";
import { requireCapability } from "@/lib/session";
import { db } from "@/lib/db";
import { workspaces, products, workspaceMembers, users } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { DistributionPanel } from "@/components/distribution/distribution-panel";

export default async function DistributionPage() {
  await requireCapability("product.distribute");

  const wsList = await db
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(eq(workspaces.isArchived, false));

  const [unassignedRows, empRows] = await Promise.all([
    db
      .select({ workspaceId: products.workspaceId, count: sql<number>`count(*)::int` })
      .from(products)
      // Match the distribution engine: only published (non-draft) unassigned
      // products are distributable. Drafts are hidden from employees.
      .where(and(isNull(products.assignedTo), eq(products.isDraft, false)))
      .groupBy(products.workspaceId),
    db
      .select({ workspaceId: workspaceMembers.workspaceId, count: sql<number>`count(*)::int` })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(users.role, "employee"))
      .groupBy(workspaceMembers.workspaceId),
  ]);

  const unassignedMap = new Map(unassignedRows.map((r) => [r.workspaceId, r.count]));
  const empMap = new Map(empRows.map((r) => [r.workspaceId, r.count]));

  const data = wsList.map((w) => ({
    id: w.id,
    name: w.name,
    unassigned: unassignedMap.get(w.id) ?? 0,
    employees: empMap.get(w.id) ?? 0,
  }));

  return (
    <div>
      <PageHeader
        title="توزيع المنتجات"
        description="وزّع المنتجات غير المعيّنة تلقائياً على الموظفين"
      />
      {data.length === 0 ? (
        <EmptyState icon="Shuffle" title="لا توجد مساحات عمل" />
      ) : (
        <DistributionPanel workspaces={data} />
      )}
    </div>
  );
}
