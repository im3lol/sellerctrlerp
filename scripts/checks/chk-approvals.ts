// Live check of the approval engine against the real DB, inside ONE transaction that is
// rolled back at the end — nothing it writes survives. Run after touching lib/erp/approvals.ts:
//   DATABASE_URL=postgres://sellerctrl:sellerctrl@localhost:5433/sellerctrl npx tsx --tsconfig tsconfig.script.json scripts/checks/chk-approvals.ts
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { organizations, organizationMembers, approvalRequests, auditLogs } from "@/db/schema";
import { approvalGate, decideApproval } from "@/lib/erp/approvals";
import { runWithErpContext } from "@/lib/erp/erp-context";
import { randomUUID } from "node:crypto";

const ROLLBACK = new Error("__rollback__");
const out: string[] = [];
const check = (name: string, cond: boolean, extra = "") => out.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);

async function main() {
  const [org] = await withOrgScope("", true, () => db.execute<{ id: string }>(sql`
    select o.id from organizations o join organization_members m on m.organization_id = o.id
    group by o.id having count(*) >= 3 limit 1`)).then((r) => r.rows);
  if (!org) throw new Error("no multi-member org");
  const orgId = org.id;

  try {
    await withOrgScope(orgId, false, async () => {
      const members = await db.select({ userId: organizationMembers.userId, role: organizationMembers.role })
        .from(organizationMembers).where(eq(organizationMembers.organizationId, orgId));
      const by = (r: string) => members.find((m) => m.role === r)!;
      const admin = by("admin"), sales = by("sales"), accountant = by("accountant");
      out.push(`org ${orgId.slice(0, 8)} · admin/sales/accountant present: ${!!admin}/${!!sales}/${!!accountant}`);

      await db.update(organizations).set({ approvalPolicy: { enabled: true, purchaseOrder: 1000 } }).where(eq(organizations.id, orgId));
      const po = randomUUID();
      const facts = (total: number) => ({ docType: "PURCHASE_ORDER" as const, total });
      const count = async (status?: string) => Number((await db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests)
        .where(and(eq(approvalRequests.entityId, po), ...(status ? [eq(approvalRequests.status, status)] : []))))[0].n);

      // A: a non-approver confirms above the limit → held, one PENDING request
      const a = await approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: po, entityNumber: "PO-TEST", amount: 5000, facts: facts(5000) });
      check("sales above limit is held", "error" in a, "error" in a ? a.error : "");
      check("one PENDING request filed", (await count("PENDING")) === 1);

      // B: confirming again doesn't queue it twice
      await approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: po, entityNumber: "PO-TEST", amount: 5000, facts: facts(5000) });
      check("second confirm doesn't duplicate", (await count()) === 1);

      // Below the limit passes untouched
      const small = await approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: randomUUID(), amount: 500, facts: facts(500) });
      check("below the limit passes", !("error" in small));

      const [req] = await db.select({ id: approvalRequests.id }).from(approvalRequests).where(eq(approvalRequests.entityId, po)).limit(1);

      // C/D: people without approvals.decide are refused
      const c = await decideApproval({ orgId, userId: sales.userId, role: "sales", requestId: req.id, decision: "APPROVE" });
      check("requester without the permission can't approve", "error" in c, "error" in c ? c.error : "");
      const d = await decideApproval({ orgId, userId: accountant.userId, role: "accountant", requestId: req.id, decision: "APPROVE" });
      check("accountant (no grant) can't approve", "error" in d);

      // Rejection needs a reason
      const noReason = await decideApproval({ orgId, userId: admin.userId, role: "admin", requestId: req.id, decision: "REJECT" });
      check("reject without a reason is refused", "error" in noReason);

      // E: the admin approves → the same facts now pass
      const e = await decideApproval({ orgId, userId: admin.userId, role: "admin", requestId: req.id, decision: "APPROVE" });
      check("admin approves", !("error" in e));
      const e2 = await approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: po, amount: 5000, facts: facts(5000) });
      check("approved facts now confirm", !("error" in e2));
      const [aud] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs).where(and(eq(auditLogs.entityId, po), eq(auditLogs.action, "APPROVE")));
      check("APPROVE written to the audit trail", Number(aud.n) === 1);

      // F: the order changes → the old approval doesn't cover it
      const f = await approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: po, amount: 6000, facts: facts(6000) });
      check("changed amount needs approving again", "error" in f);

      // G: an admin confirming their own document self-approves, on the record
      const own = randomUUID();
      const g = await approvalGate({ orgId, userId: admin.userId, role: "admin", entityId: own, amount: 9000, facts: facts(9000) });
      const [gr] = await db.select({ status: approvalRequests.status, decidedBy: approvalRequests.decidedBy }).from(approvalRequests).where(eq(approvalRequests.entityId, own));
      check("admin self-approves and it's recorded", !("error" in g) && gr?.status === "APPROVED" && gr.decidedBy === admin.userId);

      // H: the marketplace worker is never held
      const sys = randomUUID();
      const h = await runWithErpContext({ userId: admin.userId, orgId, role: "admin", permissions: new Set(), system: true },
        () => approvalGate({ orgId, userId: sales.userId, role: "sales", entityId: sys, amount: 99999, facts: facts(99999) }));
      const [hn] = await db.select({ n: sql<number>`count(*)::int` }).from(approvalRequests).where(eq(approvalRequests.entityId, sys));
      check("worker (system) passes with no request", !("error" in h) && Number(hn.n) === 0);

      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  const [left] = await withOrgScope(orgId, false, () => db.select({ p: organizations.approvalPolicy }).from(organizations).where(eq(organizations.id, orgId)));
  out.push(`rolled back — policy after run: ${JSON.stringify(left?.p ?? null)}`);
  console.log(out.join("\n"));
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
