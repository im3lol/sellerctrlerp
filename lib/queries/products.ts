import { and, eq, or, ilike, isNull, isNotNull, inArray, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { products, productBases, productStatuses, users, workspaces, workspaceMembers } from "@/db/schema";
import { orgWorkspaceIds } from "@/lib/crm/scope";

// Base catalog data (name, image, price…) lives in productBases — single source.
const base = productBases;

export const PRODUCTS_PER_PAGE = 20;

export type ProductFilters = {
  orgId?: string; // restrict to the active organization's workspaces (tenant scope)
  workspaceId?: string;
  workspaceIds?: string[]; // restrict to a set (access scoping)
  statusId?: string;
  assignedTo?: string;
  search?: string;
  // Draft = incomplete data, hidden from employees until completed & confirmed.
  // "exclude" (default): published only. "only": drafts only. "all": both.
  draft?: "exclude" | "only" | "all";
  // Only products whose core fields (name+image+price) are filled ("ready").
  ready?: boolean;
};

const assignee = users;

/** Build the WHERE conditions shared by listProducts + countProducts. Returns
 *  null when the filter set is provably empty (e.g. no accessible workspaces). */
function buildConds(filters: ProductFilters): unknown[] | null {
  const conds = [];
  // Tenant scope: products only within the active org's workspaces.
  if (filters.orgId) conds.push(inArray(products.workspaceId, orgWorkspaceIds(filters.orgId)));
  if (filters.workspaceId) conds.push(eq(products.workspaceId, filters.workspaceId));
  else if (filters.workspaceIds) {
    if (filters.workspaceIds.length === 0) return null;
    conds.push(inArray(products.workspaceId, filters.workspaceIds));
  }
  if (filters.draft === "only") conds.push(eq(products.isDraft, true));
  else if (filters.draft !== "all") conds.push(eq(products.isDraft, false));
  if (filters.ready) {
    conds.push(isNotNull(base.imageUrl), isNotNull(base.price));
  }
  if (filters.statusId) conds.push(eq(products.statusId, filters.statusId));
  if (filters.assignedTo === "unassigned") conds.push(isNull(products.assignedTo));
  else if (filters.assignedTo) conds.push(eq(products.assignedTo, filters.assignedTo));
  if (filters.search) {
    const q = `%${filters.search}%`;
    conds.push(or(ilike(base.name, q), ilike(products.sku, q), ilike(products.asin, q)));
  }
  return conds;
}

/** Total count matching the filters (for pagination). */
export async function countProducts(filters: ProductFilters): Promise<number> {
  const conds = buildConds(filters);
  if (conds === null) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(products)
    .leftJoin(base, eq(products.baseId, base.id))
    .where(conds.length ? and(...(conds as never[])) : undefined);
  return row?.count ?? 0;
}

export async function listProducts(filters: ProductFilters, limit = 200, offset = 0) {
  const conds = buildConds(filters);
  if (conds === null) return [];

  return db
    .select({
      id: products.id,
      workspaceId: products.workspaceId,
      sku: products.sku,
      name: base.name,
      asin: products.asin,
      brand: base.brand,
      price: base.price,
      imageUrl: base.imageUrl,
      productUrl: base.productUrl,
      notes: products.notes,
      amazonCode: products.amazonCode,
      assignedTo: products.assignedTo,
      isDraft: products.isDraft,
      updatedAt: products.updatedAt,
      statusId: products.statusId,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      assigneeName: assignee.name,
      assigneeAvatar: assignee.avatarUrl,
      workspaceName: workspaces.name,
      workspaceType: workspaces.type,
    })
    .from(products)
    .leftJoin(base, eq(products.baseId, base.id))
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(assignee, eq(products.assignedTo, assignee.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(conds.length ? and(...(conds as never[])) : undefined)
    .orderBy(desc(products.updatedAt))
    .limit(limit)
    .offset(offset);
}

export type ProductRow = Awaited<ReturnType<typeof listProducts>>[number];

export async function getProductDetail(id: string) {
  const [p] = await db
    .select({
      product: products,
      base: base,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      assigneeName: users.name,
      assigneeAvatar: users.avatarUrl,
      workspaceName: workspaces.name,
    })
    .from(products)
    .leftJoin(base, eq(products.baseId, base.id))
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(users, eq(products.assignedTo, users.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(eq(products.id, id))
    .limit(1);
  if (!p) return null;
  // Merge base data onto the product so callers read p.product.name etc. as before.
  const b = p.base;
  return {
    ...p,
    product: {
      ...p.product,
      name: b?.name ?? "",
      brand: b?.brand ?? null,
      description: b?.description ?? null,
      sizes: b?.sizes ?? null,
      features: b?.features ?? null,
      colors: b?.colors ?? null,
      imageUrl: b?.imageUrl ?? null,
      galleryUrl: b?.galleryUrl ?? null,
      productUrl: b?.productUrl ?? null,
      price: b?.price ?? null,
      baseData: b?.baseData ?? {},
    },
  };
}

/**
 * A user's assigned-product workload, aggregated per workspace, with how many
 * are completed (terminal status). Powers the "product progress" bars — one per
 * workspace instead of hundreds of per-product tasks.
 */
export async function myProductProgress(userId: string) {
  return db
    .select({
      workspaceId: products.workspaceId,
      workspaceName: workspaces.name,
      total: sql<number>`count(*)::int`,
      completed: sql<number>`count(*) filter (where ${productStatuses.isTerminal})::int`,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .where(and(eq(products.assignedTo, userId), eq(products.isDraft, false)))
    .groupBy(products.workspaceId, workspaces.name);
}

/**
 * All platform listings that share a product's base catalog item — each with
 * its platform (workspace), code, and status. Powers the product detail
 * "platforms" panel (same product across Amazon/Noon/…).
 */
export async function listingsForBase(baseId: string) {
  return db
    .select({
      id: products.id,
      workspaceId: products.workspaceId,
      workspaceName: workspaces.name,
      workspaceType: workspaces.type,
      amazonCode: products.amazonCode,
      isDraft: products.isDraft,
      statusName: productStatuses.name,
      statusColor: productStatuses.color,
      assigneeName: users.name,
    })
    .from(products)
    .leftJoin(productStatuses, eq(products.statusId, productStatuses.id))
    .leftJoin(workspaces, eq(products.workspaceId, workspaces.id))
    .leftJoin(users, eq(products.assignedTo, users.id))
    .where(eq(products.baseId, baseId))
    .orderBy(workspaces.name);
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
