"use server";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { organizationMembers, salesQuotations } from "@/db/schema";
import { verifyDocLink, docLinkSecret } from "@/lib/erp/doc-link";
import { tryRecordAudit } from "@/lib/erp/audit";
import { notifyUsers } from "@/lib/erp/approval-notify";

/**
 * A customer accepting or rejecting a quotation from its link — no account. The signed
 * token is re-verified here (never trust the page that sent it), only a draft or sent
 * quotation can move, and it moves once. The audit names the customer's reply; the
 * company's admins and sales people are told.
 */
export async function respondQuotationAction(token: string, decision: "ACCEPTED" | "REJECTED", name: string): Promise<{ ok: boolean; error?: string }> {
  const link = verifyDocLink(docLinkSecret(), token);
  if (!link || link.k !== "QT") return { ok: false, error: "الرابط انتهى أو مش صحيح" };
  if (decision !== "ACCEPTED" && decision !== "REJECTED") return { ok: false, error: "رد غير معروف" };
  const who = (name ?? "").trim().slice(0, 80);

  const done = await withOrgScope(link.o, false, async () => {
    const [moved] = await db.update(salesQuotations).set({ status: decision, updatedAt: new Date() })
      .where(and(
        eq(salesQuotations.id, link.id), eq(salesQuotations.organizationId, link.o),
        inArray(salesQuotations.status, ["DRAFT", "SENT"]),
      ))
      .returning({ number: salesQuotations.number });
    if (!moved) return null;
    await tryRecordAudit({
      orgId: link.o, userId: null, action: decision === "ACCEPTED" ? "CONFIRM" : "UPDATE",
      entityType: "QUOTATION", entityId: link.id, entityNumber: moved.number,
      summary: `${decision === "ACCEPTED" ? "العميل وافق على" : "العميل رفض"} عرض السعر من الرابط${who ? ` — ${who}` : ""}`,
    });
    const people = await db.select({ userId: organizationMembers.userId }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, link.o), eq(organizationMembers.isActive, true), inArray(organizationMembers.role, ["admin", "sales"])));
    return { number: moved.number, people: people.map((p) => p.userId) };
  });
  if (!done) return { ok: false, error: "العرض ده اتردّ عليه قبل كده" };

  await notifyUsers(link.o, done.people,
    `${decision === "ACCEPTED" ? "✅ العميل وافق على" : "❌ العميل رفض"} عرض السعر ${done.number}`,
    who ? [`باسم: ${who}`] : [], `/sales/quotations/${encodeURIComponent(done.number)}`);
  return { ok: true };
}
