import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { memberWorkspaceIds } from "@/lib/workspaces";
import { listProducts, listStatuses, type ProductFilters } from "@/lib/queries/products";
import { PageHeader } from "@/components/page-header";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsFilters } from "@/components/products/products-filters";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = can(user.role, "workspace.viewAll");
  const canEdit = can(user.role, "product.edit");

  const filters: ProductFilters = {
    statusId: sp.statusId,
    assignedTo: sp.assignedTo,
    search: sp.search,
  };
  if (!manager) filters.workspaceIds = await memberWorkspaceIds(user.id);

  const [rows, statuses, employees] = await Promise.all([
    listProducts(filters),
    listStatuses(),
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.role, "employee")),
  ]);

  const statusOptions = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }));

  return (
    <div>
      <PageHeader title="المنتجات" description={`${rows.length} منتج`} />
      <ProductsFilters statuses={statusOptions} assignees={employees} />
      <ProductsTable
        rows={rows}
        statuses={statusOptions}
        assignees={employees}
        canEdit={canEdit}
        showWorkspace
      />
    </div>
  );
}
