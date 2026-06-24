import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workspaces } from "@/db/schema";

/**
 * Subquery of workspace ids belonging to an organization. CRM rows (products,
 * tasks, files, …) are scoped to the active org by constraining their
 * `workspaceId` to this set — e.g. `inArray(products.workspaceId, orgWorkspaceIds(orgId))`.
 * Keeps CRM queries org-scoped exactly like the ERP tables, without a column on
 * every child table.
 */
export function orgWorkspaceIds(orgId: string) {
  return db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.organizationId, orgId));
}
