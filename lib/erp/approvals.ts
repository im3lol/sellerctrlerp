import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { approvalRequests, organizations, purchaseOrders, users } from "@/db/schema";
import { getErpContext } from "@/lib/erp/erp-context";
import { getMemberAccess } from "@/lib/erp/auth-guard";
import { tryRecordAudit } from "@/lib/erp/audit";
import {
  parseApprovalPolicy, needsApproval, canSelfApprove, decisionBlocked,
  type ApprovalPolicy, type ApprovalFacts, type ApprovalDocType,
} from "@/lib/erp/approval-policy";

/**
 * Manager approvals — the database half. The rules live in approval-policy.ts (pure);
 * this file stores requests and enforces them at confirm time.
 *
 * Every function expects to run inside the caller's org scope (a server action or a
 * loadErpPage page), which is where all of them are called from.
 */

export const APPROVAL_DOC_LABEL: Record<ApprovalDocType, string> = {
  PURCHASE_ORDER: "أمر شراء",
  SALES_ORDER: "أمر بيع",
  STOCK_ADJUSTMENT: "تسوية مخزون",
  PAYMENT: "سند صرف",
  EXPENSE: "مصروف",
  EXPENSE_CLAIM: "مطالبة مصروفات",
};

export async function getApprovalPolicy(orgId: string): Promise<ApprovalPolicy> {
  const [o] = await db.select({ p: organizations.approvalPolicy }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  return parseApprovalPolicy(o?.p);
}

type SessionLike = Parameters<typeof getMemberAccess>[1];

/** Does this member hold approvals.decide? A platform super-admin always does. */
async function canDecide(orgId: string, userId: string, role: string): Promise<boolean> {
  if (role === "super_admin") return true;
  // getMemberAccess resolves role ± per-member overrides — the single source of truth
  // for permissions. It only reads `id` and the OS `role` (for the system_admin bypass).
  const access = await getMemberAccess(orgId, { id: userId, role: "employee" } as SessionLike);
  return access.permissions.has("approvals.decide");
}

const effectiveRole = (role: string) => (role === "super_admin" ? "admin" : role);

async function latestRequest(orgId: string, entityType: string, entityId: string) {
  const [r] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.entityType, entityType), eq(approvalRequests.entityId, entityId)))
    .orderBy(desc(approvalRequests.requestedAt)).limit(1);
  return r ?? null;
}

export type GateInput = {
  orgId: string;
  userId: string;
  role: string;
  entityId: string;
  entityNumber?: string | null;
  amount?: number | null;
  facts: ApprovalFacts;
};

/**
 * Call right before a document is confirmed/posted. Returns ok when no approval is
 * needed or an approval for exactly these facts exists; otherwise files a request (once)
 * and returns the error the action should show.
 */
export async function approvalGate(i: GateInput): Promise<{ ok: true } | { error: string; pending: true }> {
  // The marketplace worker: prices and discounts come from the platform.
  if (getErpContext()?.system) return { ok: true };

  const reason = needsApproval(await getApprovalPolicy(i.orgId), i.facts);
  if (!reason) return { ok: true };

  const entityType = i.facts.docType;
  const latest = await latestRequest(i.orgId, entityType, i.entityId);
  if (latest?.status === "APPROVED" && latest.reason === reason) return { ok: true };

  // An admin who may decide would approve it a moment later anyway — record the
  // approval and carry on, instead of making the owner of a one-person company click twice.
  if (canSelfApprove(effectiveRole(i.role), await canDecide(i.orgId, i.userId, i.role))) {
    const now = new Date();
    await db.insert(approvalRequests).values({
      organizationId: i.orgId, entityType, entityId: i.entityId, entityNumber: i.entityNumber ?? null,
      amount: i.amount != null ? String(i.amount) : null, reason, status: "APPROVED",
      requestedBy: i.userId, requestedAt: now, decidedBy: i.userId, decidedAt: now, comment: "اعتماد ذاتي (مدير)",
    });
    await tryRecordAudit({ orgId: i.orgId, userId: i.userId, action: "APPROVE", entityType, entityId: i.entityId, entityNumber: i.entityNumber, summary: `اعتماد ذاتي — ${reason}` });
    return { ok: true };
  }

  if (latest?.status === "PENDING") {
    // The document changed while it waited — the request must describe what is being approved now.
    if (latest.reason !== reason) {
      await db.update(approvalRequests).set({ reason, amount: i.amount != null ? String(i.amount) : null, requestedAt: new Date() })
        .where(and(eq(approvalRequests.id, latest.id), eq(approvalRequests.status, "PENDING")));
    }
    return { error: `مستني اعتماد المدير: ${reason}`, pending: true };
  }

  await db.insert(approvalRequests).values({
    organizationId: i.orgId, entityType, entityId: i.entityId, entityNumber: i.entityNumber ?? null,
    amount: i.amount != null ? String(i.amount) : null, reason, status: "PENDING", requestedBy: i.userId,
  }).onConflictDoNothing(); // one open request per document (partial unique index)
  await tryRecordAudit({ orgId: i.orgId, userId: i.userId, action: "SUBMIT", entityType, entityId: i.entityId, entityNumber: i.entityNumber, summary: `طلب اعتماد — ${reason}` });
  return { error: `اتبعت للمدير يعتمده: ${reason}`, pending: true };
}

export type DecideInput = {
  orgId: string;
  userId: string;
  role: string;
  requestId: string;
  decision: "APPROVE" | "REJECT";
  comment?: string | null;
};

export async function decideApproval(d: DecideInput): Promise<{ ok: true } | { error: string }> {
  const [r] = await db.select().from(approvalRequests)
    .where(and(eq(approvalRequests.id, d.requestId), eq(approvalRequests.organizationId, d.orgId))).limit(1);
  if (!r) return { error: "الطلب غير موجود" };
  if (r.status !== "PENDING") return { error: "الطلب اتقرر فيه بالفعل" };

  const blocked = decisionBlocked({
    requestedBy: r.requestedBy, deciderId: d.userId, deciderRole: effectiveRole(d.role),
    deciderCanDecide: await canDecide(d.orgId, d.userId, d.role),
  });
  if (blocked) return { error: blocked };

  const comment = d.comment?.trim() || null;
  if (d.decision === "REJECT" && !comment) return { error: "اكتب سبب الرفض — اللي طلب محتاج يعرف يعدّل إيه" };

  const now = new Date();
  const done = await db.update(approvalRequests)
    .set({ status: d.decision === "APPROVE" ? "APPROVED" : "REJECTED", decidedBy: d.userId, decidedAt: now, comment })
    .where(and(eq(approvalRequests.id, r.id), eq(approvalRequests.status, "PENDING")))
    .returning({ id: approvalRequests.id });
  if (!done.length) return { error: "الطلب اتقرر فيه من شوية — حدّث الصفحة" };

  // Purchase orders predate this table and still show approval from their own columns.
  if (r.entityType === "PURCHASE_ORDER") {
    await db.update(purchaseOrders)
      .set(d.decision === "APPROVE" ? { approvedBy: d.userId, approvedAt: now } : { approvedBy: null, approvedAt: null })
      .where(and(eq(purchaseOrders.id, r.entityId), eq(purchaseOrders.organizationId, d.orgId)));
  }

  await tryRecordAudit({
    orgId: d.orgId, userId: d.userId, action: d.decision, entityType: r.entityType, entityId: r.entityId, entityNumber: r.entityNumber,
    summary: d.decision === "APPROVE" ? `اعتماد — ${r.reason}` : `رفض — ${r.reason} — ${comment}`,
  });
  return { ok: true };
}

/**
 * An approver acting on a document nobody has asked about yet (the Approve button on a
 * purchase order). Files the request with no requester, then decides it — so the
 * separation-of-duties rule has nothing to object to and the trail still shows who approved.
 */
export async function approveDirectly(i: Omit<GateInput, "amount"> & { amount?: number | null }): Promise<{ ok: true } | { error: string }> {
  const reason = needsApproval(await getApprovalPolicy(i.orgId), i.facts);
  if (!reason) return { error: "المستند ده مش محتاج اعتماد" };
  const entityType = i.facts.docType;
  let latest = await latestRequest(i.orgId, entityType, i.entityId);
  if (latest?.status === "APPROVED" && latest.reason === reason) return { error: "المستند معتمد بالفعل" };
  if (latest?.status !== "PENDING") {
    await db.insert(approvalRequests).values({
      organizationId: i.orgId, entityType, entityId: i.entityId, entityNumber: i.entityNumber ?? null,
      amount: i.amount != null ? String(i.amount) : null, reason, status: "PENDING", requestedBy: null,
    }).onConflictDoNothing();
    latest = await latestRequest(i.orgId, entityType, i.entityId);
  }
  if (!latest || latest.status !== "PENDING") return { error: "تعذّر تسجيل طلب الاعتماد" };
  return decideApproval({ orgId: i.orgId, userId: i.userId, role: i.role, requestId: latest.id, decision: "APPROVE" });
}

/** Withdraw an open request when its document is deleted or cancelled. */
export async function cancelApprovals(orgId: string, entityType: ApprovalDocType, entityId: string): Promise<void> {
  await db.update(approvalRequests).set({ status: "CANCELLED", decidedAt: new Date() })
    .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.entityType, entityType),
      eq(approvalRequests.entityId, entityId), eq(approvalRequests.status, "PENDING")));
}

export type ApprovalRow = {
  id: string; entityType: ApprovalDocType; entityId: string; entityNumber: string | null;
  amount: number | null; reason: string; status: string; comment: string | null;
  requestedBy: string | null; requestedByName: string | null; requestedAt: Date;
  decidedByName: string | null; decidedAt: Date | null;
};

const requester = sql<string | null>`(select u.name from users u where u.id = ${approvalRequests.requestedBy})`;
const decider = sql<string | null>`(select u.name from users u where u.id = ${approvalRequests.decidedBy})`;

function toRow(r: Record<string, unknown>): ApprovalRow {
  return { ...(r as ApprovalRow), amount: r.amount != null ? Number(r.amount) : null };
}

const cols = {
  id: approvalRequests.id, entityType: approvalRequests.entityType, entityId: approvalRequests.entityId,
  entityNumber: approvalRequests.entityNumber, amount: approvalRequests.amount, reason: approvalRequests.reason,
  status: approvalRequests.status, comment: approvalRequests.comment, requestedBy: approvalRequests.requestedBy,
  requestedByName: requester, requestedAt: approvalRequests.requestedAt, decidedByName: decider, decidedAt: approvalRequests.decidedAt,
};

/** The latest request for one document — the banner on its page. */
export async function getEntityApproval(orgId: string, entityId: string): Promise<ApprovalRow | null> {
  const [r] = await db.select(cols).from(approvalRequests)
    .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.entityId, entityId)))
    .orderBy(desc(approvalRequests.requestedAt)).limit(1);
  return r ? toRow(r) : null;
}

export async function listApprovals(orgId: string, opts: { status?: string; requestedBy?: string; limit?: number }): Promise<ApprovalRow[]> {
  const conds = [eq(approvalRequests.organizationId, orgId)];
  if (opts.status) conds.push(eq(approvalRequests.status, opts.status));
  if (opts.requestedBy) conds.push(eq(approvalRequests.requestedBy, opts.requestedBy));
  const rows = await db.select(cols).from(approvalRequests).where(and(...conds))
    .orderBy(opts.status === "PENDING" ? approvalRequests.requestedAt : desc(approvalRequests.requestedAt))
    .limit(opts.limit ?? 200);
  return rows.map(toRow);
}

export async function countPendingApprovals(orgId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests)
    .where(and(eq(approvalRequests.organizationId, orgId), eq(approvalRequests.status, "PENDING")));
  return Number(r?.n ?? 0);
}

/** Where each document type lives, for links from the inbox and notifications. */
export function approvalEntityHref(type: string, number: string | null, id: string): string {
  const n = encodeURIComponent(number ?? id);
  switch (type) {
    case "PURCHASE_ORDER": return `/purchases/orders/${n}`;
    case "SALES_ORDER": return `/sales/orders/${n}`;
    case "STOCK_ADJUSTMENT": return `/inventory/adjustments/${n}`;
    case "PAYMENT": return `/purchases/payments/${n}`;
    case "EXPENSE": return `/accounting/expenses`;
    case "EXPENSE_CLAIM": return `/hr/expense-claims/${n}`;
    default: return "/approvals";
  }
}

void users; // referenced through the name subqueries above
