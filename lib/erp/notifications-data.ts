import "server-only";
import { and, desc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { cairoToday } from "@/lib/erp/chatter";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { auditLogs, approvalRequests, docFollowUps } from "@/db/schema";

export type Activity = { action: string; summary: string | null; number: string | null; at: string; href: string | null };
export type Notifications = {
  lowStock: number;
  expiring: number;
  overdueAR: number;
  overdueTotal: number;
  overdueAP: number;
  overdueAPTotal: number;
  stockWaiting: number;
  newActivity: number;
  newOrders: number;
  needsReview: number;
  unmatched: number;
  unclaimedReturns: number;
  mktReturns: number;
  mktRemovals: number;
  mktReimbursements: number;
  /** Documents waiting for this member's approval (only counted for approvers). */
  pendingApprovals: number;
  /** Follow-ups on this member (lib/erp/chatter.ts), due today or overdue. */
  myFollowUps: number;
  total: number;
  recent: Activity[];
};

// Entity type → detail route base (documents route by their readable number).
const ENTITY_PATH: Record<string, string> = {
  SALES_ORDER: "/sales/orders", SALES_INVOICE: "/sales/invoices", DELIVERY_NOTE: "/sales/deliveries",
  SALES_RETURN: "/sales/returns", PURCHASE_ORDER: "/purchases/orders", PURCHASE_INVOICE: "/purchases/invoices",
  GOODS_RECEIPT: "/purchases/receipts", PURCHASE_RETURN: "/purchases/returns", JOURNAL_ENTRY: "/accounting/journal",
};

// Recent-activity entity type → the ERP permission needed to see it.
const ENTITY_PERM: Record<string, string> = {
  SALES_ORDER: "sales.view", SALES_INVOICE: "sales.view", DELIVERY_NOTE: "sales.view", SALES_RETURN: "sales.view",
  PURCHASE_ORDER: "purchases.view", PURCHASE_INVOICE: "purchases.view", GOODS_RECEIPT: "purchases.view", PURCHASE_RETURN: "purchases.view",
  JOURNAL_ENTRY: "accounting.view",
};

/** Org-scoped notification counts + recent activity, filtered to what `perms` allows
 *  (undefined = show everything, e.g. the daily cron). `sinceIso` counts documents
 *  created after that instant.
 *
 *  Runs inside the org's RLS scope itself. Both callers — the bell's server action and
 *  the daily digest cron — called this bare, and the app connects as `appuser`, whose
 *  RLS policies return NO rows until app.current_org is set: every count was 0 (5,270
 *  items visible to the owner, 0 to this function), so the badge never lit and the
 *  chime, which only plays when the total rises, never played. Scoping here rather than
 *  at each call site fixes both, and withOrgScope is a no-op when a scope is already open. */
export function computeNotifications(orgId: string, sinceIso?: string, perms?: Set<string>, userId?: string): Promise<Notifications> {
  return withOrgScope(orgId, false, () => compute(orgId, sinceIso, perms, userId));
}

async function compute(orgId: string, sinceIso?: string, perms?: Set<string>, userId?: string): Promise<Notifications> {
  const since = sinceIso ? new Date(sinceIso) : null;
  const can = (p: string) => !perms || perms.has(p);
  const anyDoc = can("sales.view") || can("purchases.view") || can("accounting.view");
  const ZERO = Promise.resolve({ rows: [{ n: 0 }] } as { rows: { n: number }[] });
  const ZERO_TOTAL = Promise.resolve({ rows: [{ n: 0, total: "0" }] } as { rows: { n: number; total: string }[] });

  const [low, exp, ar, ap, activity, since_, newOrdersRes, reviewRes, stockWaitRes, unmatchedRes, unclaimedReturnsRes, mktReturnsRes, mktRemovalsRes, mktReimbursementsRes] = await Promise.all([
    can("inventory.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM (
        SELECT i.id FROM items i
        LEFT JOIN (
          SELECT DISTINCT ON (item_id, warehouse_id) item_id, balance_quantity
          FROM stock_movements WHERE organization_id = ${orgId}
          ORDER BY item_id, warehouse_id, created_at DESC, split_part(number, '-', 3)::int DESC
        ) l ON l.item_id = i.id
        WHERE i.organization_id = ${orgId} AND i.is_active = true AND coalesce(i.min_stock,0) > 0
        GROUP BY i.id
        HAVING coalesce(sum(l.balance_quantity),0) <= coalesce(i.min_stock,0)
      ) s`) : ZERO,
    can("inventory.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM stock_batches
      WHERE organization_id = ${orgId} AND remaining_quantity > 0
        AND expiry_date IS NOT NULL AND expiry_date <= now() + interval '30 days'`) : ZERO,
    can("sales.view") ? db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM sales_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`) : ZERO_TOTAL,
    can("purchases.view") ? db.execute<{ n: number; total: string }>(sql`
      SELECT count(*)::int AS n, coalesce(sum(balance_due),0) AS total FROM purchase_invoices
      WHERE organization_id = ${orgId} AND balance_due > 0
        AND status NOT IN ('DRAFT','CANCELLED') AND due_date IS NOT NULL AND due_date < now()`) : ZERO_TOTAL,
    anyDoc ? db.select({ action: auditLogs.action, summary: auditLogs.summary, number: auditLogs.entityNumber, entityType: auditLogs.entityType, at: auditLogs.createdAt })
      .from(auditLogs)
      .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"])))
      .orderBy(desc(auditLogs.createdAt)).limit(16) : Promise.resolve([] as { action: string; summary: string | null; number: string | null; entityType: string; at: Date }[]),
    since && anyDoc
      ? db.select({ n: sql<number>`count(*)::int` }).from(auditLogs)
          .where(and(eq(auditLogs.organizationId, orgId), inArray(auditLogs.action, ["CREATE", "CONFIRM", "POST"]), gt(auditLogs.createdAt, since)))
      : Promise.resolve([{ n: 0 }]),
    // New marketplace (Amazon/Noon/…) sales orders since the user last looked.
    since && can("sales.view")
      ? db.execute<{ n: number }>(sql`
          SELECT count(*)::int AS n FROM sales_orders
          WHERE organization_id = ${orgId} AND channel IS NOT NULL AND created_at > ${since}`)
      : ZERO,
    // Items auto-created from marketplace orders with an unknown SKU — need a cost/review.
    can("inventory.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM items
      WHERE organization_id = ${orgId} AND needs_review = true AND is_active = true`) : ZERO,
    // DRAFT delivery notes parked by the auto-flow because stock was short — the
    // "بانتظار توفّر المخزون" marker (see STOCK_WAIT_MARK in lib/erp/fulfillment.ts).
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM delivery_notes
      WHERE organization_id = ${orgId} AND status = 'DRAFT' AND notes LIKE 'بانتظار توفّر المخزون%'`) : ZERO,
    // Marketplace orders parked because their product isn't linked to any item — the seller
    // must create the product + order manually (no auto-create). See unmatched_orders.
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM unmatched_orders
      WHERE organization_id = ${orgId} AND status = 'PENDING'`) : ZERO,
    // Marketplace returns (e.g. Noon webhook) whose DRAFT credit note isn't created yet —
    // usually the order isn't invoiced. Surfaced so deferred returns don't get lost.
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM platform_returns
      WHERE organization_id = ${orgId} AND sales_return_id IS NULL`) : ZERO,
    // Marketplace customer returns awaiting the trader's receipt decision (DRAFT channel
    // credit notes) → /sales/marketplace-returns.
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM sales_returns
      WHERE organization_id = ${orgId} AND status = 'DRAFT' AND channel IS NOT NULL AND sales_invoice_id IS NOT NULL`) : ZERO,
    // Synced removal orders awaiting the received/disposed decision → /sales/marketplace-removals.
    can("sales.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM platform_removals
      WHERE organization_id = ${orgId} AND status = 'PENDING'`) : ZERO,
    // Reimbursements awaiting recognition → /sales/marketplace-reimbursements.
    can("accounting.view") ? db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM fba_reimbursements
      WHERE organization_id = ${orgId} AND status = 'PENDING'`) : ZERO,
  ]);

  const lowStock = Number(low.rows[0]?.n ?? 0);
  const expiring = Number(exp.rows[0]?.n ?? 0);
  const overdueAR = Number(ar.rows[0]?.n ?? 0);
  const overdueTotal = Number(ar.rows[0]?.total ?? 0);
  const overdueAP = Number(ap.rows[0]?.n ?? 0);
  const overdueAPTotal = Number(ap.rows[0]?.total ?? 0);
  const newActivity = Number(since_[0]?.n ?? 0);
  const newOrders = Number(newOrdersRes.rows[0]?.n ?? 0);
  const needsReview = Number(reviewRes.rows[0]?.n ?? 0);
  const stockWaiting = Number(stockWaitRes.rows[0]?.n ?? 0);
  const unmatched = Number(unmatchedRes.rows[0]?.n ?? 0);
  const unclaimedReturns = Number(unclaimedReturnsRes.rows[0]?.n ?? 0);
  const mktReturns = Number(mktReturnsRes.rows[0]?.n ?? 0);
  const mktRemovals = Number(mktRemovalsRes.rows[0]?.n ?? 0);
  const mktReimbursements = Number(mktReimbursementsRes.rows[0]?.n ?? 0);
  const recent: Activity[] = activity
    .filter((a) => { const p = ENTITY_PERM[a.entityType]; return !p || can(p); }) // only docs this member can see
    .slice(0, 8)
    .map((a) => {
      const base = ENTITY_PATH[a.entityType];
      return { action: a.action, summary: a.summary, number: a.number, at: a.at.toISOString(), href: base && a.number ? `${base}/${encodeURIComponent(a.number)}` : null };
    });
  // Approvals waiting — only for someone who can decide them; everyone else would just
  // see a number they can do nothing about.
  const pendingApprovals = can("approvals.decide")
    ? Number((await db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests)
        .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.status, "PENDING"))))[0]?.n ?? 0)
    : 0;
  // Follow-ups on this member, due today (Cairo) or already late.
  const myFollowUps = userId
    ? Number((await db.select({ n: sql<number>`count(*)::int` }).from(docFollowUps)
        .where(and(eq(docFollowUps.organizationId, orgId), eq(docFollowUps.assignedTo, userId), isNull(docFollowUps.doneAt), lte(docFollowUps.dueDate, cairoToday()))))[0]?.n ?? 0)
    : 0;
  return { pendingApprovals, myFollowUps, lowStock, expiring, overdueAR, overdueTotal, overdueAP, overdueAPTotal, stockWaiting, newActivity, newOrders, needsReview, unmatched, unclaimedReturns, mktReturns, mktRemovals, mktReimbursements, total: pendingApprovals + myFollowUps + lowStock + expiring + overdueAR + overdueAP + stockWaiting + newActivity + newOrders + needsReview + unmatched + unclaimedReturns + mktReturns + mktRemovals + mktReimbursements, recent };
}
