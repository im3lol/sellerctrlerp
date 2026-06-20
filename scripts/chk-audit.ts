/** Verify the audit helper writes rows and the page's users-join query reads them. */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { organizations, users, auditLogs, organizationMembers } from "@/db/schema";
import { recordAudit } from "@/lib/erp/audit";

async function main() {
  const [org] = await db.select().from(organizations).limit(1);
  const [member] = await db.select({ userId: organizationMembers.userId }).from(organizationMembers)
    .where(eq(organizationMembers.organizationId, org.id)).limit(1);

  await recordAudit(db, {
    orgId: org.id, userId: member?.userId ?? null, action: "CONFIRM",
    entityType: "RECEIPT_VOUCHER", entityId: "test-id", entityNumber: "RV-2026-9999",
    summary: "اختبار سجل التدقيق", metadata: { amount: 123.45 },
  });

  // Same join the page uses (uuid = text cast).
  const rows = await db
    .select({ action: auditLogs.action, entityNumber: auditLogs.entityNumber, summary: auditLogs.summary, userName: users.name, meta: auditLogs.metadata })
    .from(auditLogs)
    .leftJoin(users, sql`${users.id} = ${auditLogs.userId}::uuid`)
    .where(and(eq(auditLogs.organizationId, org.id), eq(auditLogs.entityNumber, "RV-2026-9999")))
    .orderBy(desc(auditLogs.createdAt)).limit(1);

  const r = rows[0];
  console.log("audit row:", r ? `✅ ${r.action} ${r.entityNumber} by ${r.userName ?? "—"} | ${r.summary} | meta=${JSON.stringify(r.meta)}` : "❌ not found");

  // Clean up the test row.
  await db.delete(auditLogs).where(and(eq(auditLogs.organizationId, org.id), eq(auditLogs.entityNumber, "RV-2026-9999")));
  console.log("cleanup: removed test row");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pool.end());
