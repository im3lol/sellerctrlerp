import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, fbaReimbursements, platformReturns, platformRemovals, itemCodes } from "@/db/schema";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { normalizeCode } from "@/lib/erp/amazon-import";

// R3: recognise marketplace reimbursements against a dedicated other-income account, and
// link each one to the loss it compensates (a NOT_RECEIVED customer return or a disposed
// removal). Read helpers + the on-demand 4103 account; posting lives in the action.

/** Resolve the "تعويضات المنصات" income account (4103), creating it for older orgs whose
 *  chart predates it. Mirrors ensureAmazonAccounts' create-on-demand pattern. */
export async function ensurePlatformReimbursementAccount(orgId: string): Promise<string | null> {
  const ov = await resolveAccountIds(orgId, ["4103", "4"]);
  if (ov["4103"]) return ov["4103"];
  const parent = ov["4"]; // الإيرادات rollup
  const [row] = await db.insert(accounts).values({
    organizationId: orgId, code: "4103", nameAr: "تعويضات المنصات (إيرادات أخرى)",
    type: "REVENUE", normalBalance: "CREDIT", parentId: parent ?? null, isLeaf: true,
  }).returning({ id: accounts.id });
  return row?.id ?? null;
}

export type ReimbursementRow = {
  id: string; reimbursementId: string; approvalDate: string | null; orderId: string | null;
  sku: string | null; reason: string | null; amountTotal: number; currency: string | null;
  qtyCash: number; qtyInv: number; matchedLoss: string | null;
};

/** The reimbursements awaiting recognition (PENDING), each tagged with the loss it
 *  compensates when we can match it (order+sku → NOT_RECEIVED return / disposed removal). */
export async function getReimbursementsForReview(orgId: string): Promise<ReimbursementRow[]> {
  const rows = await db.select({
    id: fbaReimbursements.id, reimbursementId: fbaReimbursements.reimbursementId,
    approvalDate: fbaReimbursements.approvalDate, orderId: fbaReimbursements.orderId,
    sku: fbaReimbursements.sku, reason: fbaReimbursements.reason,
    amountTotal: fbaReimbursements.amountTotal, currency: fbaReimbursements.currency,
    qtyCash: fbaReimbursements.quantityReimbursedCash, qtyInv: fbaReimbursements.quantityReimbursedInventory,
  }).from(fbaReimbursements)
    .where(and(eq(fbaReimbursements.organizationId, orgId), eq(fbaReimbursements.status, "PENDING")))
    .orderBy(desc(fbaReimbursements.approvalDate)).limit(200);
  if (rows.length === 0) return [];

  // Loss lookup: NOT_RECEIVED customer returns by order, disposed removals by sku.
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const returnLoss = orderIds.length
    ? await db.select({ orderId: platformReturns.orderId }).from(platformReturns)
        .where(and(eq(platformReturns.organizationId, orgId), eq(platformReturns.status, "NOT_RECEIVED"), inArray(platformReturns.orderId, orderIds)))
    : [];
  const lostOrders = new Set(returnLoss.map((r) => r.orderId));
  const disposed = await db.select({ sku: platformRemovals.sku }).from(platformRemovals)
    .where(and(eq(platformRemovals.organizationId, orgId), eq(platformRemovals.status, "DISPOSED")));
  const disposedSkus = new Set(disposed.map((d) => normalizeCode(d.sku)));

  return rows.map((r) => {
    let matchedLoss: string | null = null;
    if (r.orderId && lostOrders.has(r.orderId)) matchedLoss = "مرتجع لم يُستلم";
    else if (r.sku && disposedSkus.has(normalizeCode(r.sku))) matchedLoss = "سحب متلَف";
    return {
      id: r.id, reimbursementId: r.reimbursementId,
      approvalDate: r.approvalDate ? new Date(r.approvalDate).toISOString() : null,
      orderId: r.orderId, sku: r.sku, reason: r.reason, amountTotal: Number(r.amountTotal),
      currency: r.currency, qtyCash: Number(r.qtyCash), qtyInv: Number(r.qtyInv), matchedLoss,
    };
  });
}

/** Count of reimbursements not yet recognised (for badges/notifications). */
export async function pendingReimbursementsCount(orgId: string): Promise<number> {
  const rows = await db.select({ id: fbaReimbursements.id }).from(fbaReimbursements)
    .where(and(eq(fbaReimbursements.organizationId, orgId), eq(fbaReimbursements.status, "PENDING")));
  return rows.length;
}
