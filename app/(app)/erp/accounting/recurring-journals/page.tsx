import { and, asc, desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { recurringJournals, recurringJournalLines, accounts } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RecurringJournalsManager } from "@/components/erp/recurring-journals-manager";

const ymd = (d: Date | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");

export default async function RecurringJournalsPage() {
  const { orgId } = await requireErpModule("accounting.view");

  const [tpls, lineRows, accList] = await Promise.all([
    db.select().from(recurringJournals).where(eq(recurringJournals.organizationId, orgId)).orderBy(desc(recurringJournals.isActive), asc(recurringJournals.nextRunDate)),
    db.select({ rjId: recurringJournalLines.recurringJournalId, accountId: recurringJournalLines.accountId, debit: recurringJournalLines.debit, credit: recurringJournalLines.credit, description: recurringJournalLines.description })
      .from(recurringJournalLines)
      .innerJoin(recurringJournals, eq(recurringJournals.id, recurringJournalLines.recurringJournalId))
      .where(eq(recurringJournals.organizationId, orgId)),
    db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr }).from(accounts)
      .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true))).orderBy(asc(accounts.code)),
  ]);

  const linesByRj = new Map<string, { accountId: string; debit: number; credit: number; description: string }[]>();
  for (const l of lineRows) {
    const arr = linesByRj.get(l.rjId) ?? [];
    arr.push({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit), description: l.description ?? "" });
    linesByRj.set(l.rjId, arr);
  }

  const items = tpls.map((t) => ({
    id: t.id, name: t.name, description: t.description ?? "", frequency: t.frequency, nextRunDate: ymd(t.nextRunDate),
    isActive: t.isActive, lines: linesByRj.get(t.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="BookText" title="القيود المتكررة" subtitle="قوالب تولّد قيداً كمسودة تلقائياً (استحقاقات، إهلاك مقدّم…)" backHref="/erp/accounting/journal" />
      <RecurringJournalsManager items={items} accounts={accList} />
    </div>
  );
}
