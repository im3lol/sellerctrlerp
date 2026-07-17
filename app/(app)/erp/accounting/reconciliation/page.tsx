import { and, asc, desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntryLines, journalEntries, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { ReconciliationClient } from "@/components/erp/reconciliation-client";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const accountId = (await searchParams).account ?? "";

    const bankAccs = await db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true),
        sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`))
      .orderBy(asc(accounts.code));
    const accounts_opt = bankAccs.map((a) => ({ id: a.id, label: `${a.code} — ${a.name}` }));

    let lines: { id: string; date: string; number: string; description: string; debit: number; credit: number; reconciled: boolean }[] = [];
    if (accountId && bankAccs.some((a) => a.id === accountId)) {
      const rows = await db.select({
        id: journalEntryLines.id, date: journalEntries.date, number: journalEntries.number,
        description: journalEntryLines.description, debit: journalEntryLines.debit, credit: journalEntryLines.credit, reconciled: journalEntryLines.reconciled,
      })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .where(and(eq(journalEntries.organizationId, orgId), eq(journalEntries.status, "POSTED"), eq(journalEntryLines.accountId, accountId)))
        .orderBy(desc(journalEntries.date), desc(journalEntries.number));
      lines = rows.map((r) => ({ id: r.id, date: dt(r.date), number: r.number, description: r.description ?? "", debit: Number(r.debit), credit: Number(r.credit), reconciled: r.reconciled }));
    }

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Landmark" title="مطابقة الحساب البنكي" subtitle="طابِق حركات الدفاتر مع كشف حساب البنك" backHref="/erp/accounting" />
        <ReconciliationClient accounts={accounts_opt} selectedAccountId={accountId} lines={lines} />
      </div>
    );
  });
}
