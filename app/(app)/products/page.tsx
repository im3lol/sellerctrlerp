import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { memberWorkspaceIds, getAccessibleWorkspaces } from "@/lib/workspaces";
import { listProducts, listStatuses, type ProductFilters } from "@/lib/queries/products";
import { PageHeader } from "@/components/page-header";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsFilters } from "@/components/products/products-filters";
import { ProductFormDialog } from "@/components/products/product-form-dialog";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const manager = can(user.role, "workspace.viewAll");
  const canEdit = can(user.role, "product.edit");
  const canReview = can(user.role, "product.review");

  const filters: ProductFilters = {
    statusId: sp.statusId,
    assignedTo: sp.assignedTo,
    search: sp.search,
    // Reviewers (managers/leads) see drafts too so they can complete & confirm them;
    // employees/clients only ever see published products.
    draft: canReview ? "all" : "exclude",
  };
  // Employees see ONLY products assigned to them; team leads/others see their
  // workspaces; managers see everything.
  if (user.role === "employee") {
    filters.assignedTo = user.id;
  } else if (!manager) {
    filters.workspaceIds = await memberWorkspaceIds(user.id);
  }

  const [rows, statuses, employees] = await Promise.all([
    listProducts(filters),
    listStatuses(),
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.role, "employee")),
  ]);

  const statusOptions = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const canAdd = can(user.role, "product.distribute");
  const wsList = canAdd ? (await getAccessibleWorkspaces(user)).map((w) => ({ id: w.id, name: w.name })) : [];

  return (
    <div>
      <PageHeader title="المنتجات" description={`${rows.length} منتج`}>
        {canAdd && wsList.length > 0 && (
          <ProductFormDialog mode="create" workspaces={wsList} statuses={statusOptions} assignees={employees} />
        )}
      </PageHeader>
      <ProductsFilters statuses={statusOptions} assignees={employees} />
      <ProductsTable
        rows={rows}
        statuses={statusOptions}
        assignees={employees}
        canEdit={canEdit}
        canReview={canReview}
        showWorkspace
        showAssignee={user.role !== "employee"}
      />
    </div>
  );
}
