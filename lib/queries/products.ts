import { and, eq, or, ilike, isNull, inArray, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productStatuses, users, workspaces, workspaceMembers } from "@/db/schema";

export type ProductFilters = {
  workspaceId?: string;
  workspaceIds?: string[]; // restrict to a set (access scoping)
  statusId?: string;
  assignedTo?: string;
  search?: string;
};

const assignee = users;

export async function listProducts(filters: ProductFilters, limit = 200) {
  const conds = [];
  if (filters.workspaceId) conds.push(eq(products.workspaceId, filters.workspaceId));
  else if (filters.workspaceIds) {
    if (filters.workspaceIds.length === 0) return [];
    conds.push(inArray(products.workspaceId, filters.workspaceIds));
  }
  if (filters.statusId) conds.push(eq(products.statusId, filters.statusId));
  if (filters.assignedTo === "unassigned") conds.push(isNull(products.assignedTo));
  else if (filters.assignedTo) conds.push(eq(products.assignedTo, filters.assignedTo));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conds.push(or(ilike(products.name, q), ilike(products.sku, q), ilike(products.asin, q)));
  }

  return db
    .select({
      id: products.id,
      workspaceId: products.workspaceId,
      sku: products.sku,
      name: products.name,
      asin: products.asin,
      brand: products.brand,
      price: products.price,
      imageUrl: products.imageUrl,
      notes: products.notes,
      amazonCode: products.amazonCode,
      assignedTo: products.assignedTo,
      updatedAt: products.updatedAt,
      statusId: products.statusId,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      assigneeName: assignee.name,
      assigneeAvatar: assignee.avatarUrl,
      workspaceName: workspaces.name,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(assignee, eq(products.assignedTo, assignee.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(products.updatedAt))
    .limit(limit);
}

export type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];

export async function getProductDetail(id: string) {
  const [p] = await db
    .select({
      product: products,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      workspaceName: workspaces.name,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(users, eq(products.assignedTo, users.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(eq(products.id, id))
    .limit(1);
  return p ?? null;
}

/** Statuses available for a workspace: globals + workspace-specific. */
export async function listStatuses(workspaceId?: string) {
  const rows = await db
    .select()
    .from(productStatuses)
    .where(
      workspaceId
        ? or(isNull(productStatuses.workspaceId), eq(productStatuses.workspaceId, workspaceId))
        : isNull(productStatuses.workspaceId),
    )
    .orderBy(productStatuses.sortOrder);
  return rows;
}

/** Members of a workspace usable as product assignees. */
export async function workspaceAssignees(workspaceId: string) {
  return db
    .select({ id: users.id, name: users.name, avatarUrl: users.avatarUrl })
    .from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(users.name);
}
