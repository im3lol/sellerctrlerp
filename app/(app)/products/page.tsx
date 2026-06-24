import { eq } from "drizzle-orm";
import { requireCrm } from "@/lib/crm/guard";
import { can } from "@/lib/rbac";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { memberWorkspaceIds, getAccessibleWorkspaces } from "@/lib/workspaces";
import {
  listProducts,
  countProducts,
  listStatuses,
  PRODUCTS_PER_PAGE,
  type ProductFilters,
} from "@/lib/queries/products";
import { PageHeader } from "@/components/page-header";
import { ProductsTable } from "@/components/products/products-table";
import { ProductsFilters } from "@/components/products/products-filters";
import { ProductFormDialog } from "@/components/products/product-form-dialog";
import { ProductsPagination } from "@/components/products/products-pagination";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const { user, orgId } = await requireCrm();
  const sp = await searchParams;
  const manager = can(user.role, "workspace.viewAll");
  const canEdit = can(user.role, "product.edit");
  const canReview = can(user.role, "product.review");

  const filters: ProductFilters = {
    orgId,
    statusId: sp.statusId,
    assignedTo: sp.assignedTo,
    search: sp.search,
    // Reviewers (managers/leads) see drafts too so they can complete & confirm them;
    // employees/clients only ever see published products.
    draft: canReview ? "all" : "exclude",
  };
  // View filter (reviewers only): all | drafts | ready | published.
  if (canReview) {
    if (sp.view === "drafts") filters.draft = "only";
    else if (sp.view === "ready") {
      filters.draft = "only";
      filters.ready = true;
    } else if (sp.view === "published") filters.draft = "exclude";
  }
  // Employees see ONLY products assigned to them; team leads/others see their
  // workspaces; managers see everything.
  if (user.role === "employee") {
    filters.assignedTo = user.id;
  } else if (!manager) {
    filters.workspaceIds = await memberWorkspaceIds(user.id);
  }

  const page = Math.max(1, Number(sp.page) || 1);
  const offset = (page - 1) * PRODUCTS_PER_PAGE;

  const [rows, total, statuses, employees] = await Promise.all([
    listProducts(filters, PRODUCTS_PER_PAGE, offset),
    countProducts(filters),
    listStatuses(),
    db.select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl }).from(users).where(eq(users.role, "employee")),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PRODUCTS_PER_PAGE));
  const statusOptions = statuses.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const canAdd = can(user.role, "product.distribute");
  const wsList = canAdd ? (await getAccessibleWorkspaces(user, orgId)).map((w) => ({ id: w.id, name: w.name })) : [];

  return (
    <div>
      <PageHeader title="المنتجات" description={`${total} منتج`}>
        {canAdd && wsList.length > 0 && (
          <ProductFormDialog mode="create" workspaces={wsList} statuses={statusOptions} assignees={employees} />
        )}
      </PageHeader>
      <ProductsFilters statuses={statusOptions} assignees={employees} showDraftFilter={canReview} />
      <ProductsTable
        rows={rows}
        statuses={statusOptions}
        assignees={employees}
        canEdit={canEdit}
        canReview={canReview}
        canDelete={canAdd}
        canAssign={canReview}
        showWorkspace
        showAssignee={user.role !== "employee"}
      />
      <ProductsPagination page={page} totalPages={totalPages} total={total} perPage={PRODUCTS_PER_PAGE} />
    </div>
  );
}
