import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, costCenters, journalEntries, journalEntryLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { JournalEntryForm, type JournalEntryInitial } from "@/components/erp/journal-entry-form";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditJournalEntryPage({ params }: { params: Promise<{ number: string }> }) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("accounting.create", async ({ orgId }) => {
    const [entry] = await db.select().from(journalEntries)
      .where(and(UUID_RE.test(raw) ? eq(journalEntries.id, raw) : eq(journalEntries.number, raw), eq(journalEntries.organizationId, orgId))).limit(1);
    if (!entry) notFound();
    // Only manual drafts are editable.
    if (entry.status !== "DRAFT" || entry.sourceType !== "MANUAL") redirect(`/accounting/journal/${encodeURIComponent(entry.number)}`);

    const [accountList, centerList, eLines] = await Promise.all([
      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr }).from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.allowManualEntries, true))).orderBy(asc(accounts.code)),
      db.select({ id: costCenters.id, code: costCenters.code, nameAr: costCenters.nameAr }).from(costCenters)
        .where(and(eq(costCenters.organizationId, orgId), eq(costCenters.isActive, true))).orderBy(asc(costCenters.code)),
      db.select({ accountId: journalEntryLines.accountId, description: journalEntryLines.description, debit: journalEntryLines.debit, credit: journalEntryLines.credit, costCenterId: journalEntryLines.costCenterId })
        .from(journalEntryLines).where(eq(journalEntryLines.journalEntryId, entry.id)),
    ]);

    const initial: JournalEntryInitial = {
      id: entry.id, date: new Date(entry.date).toISOString().slice(0, 10), description: entry.description ?? "", reference: entry.reference ?? "",
      lines: eLines.map((l) => ({
        accountId: l.accountId, description: l.description ?? "",
        debit: Number(l.debit) ? String(Number(l.debit)) : "", credit: Number(l.credit) ? String(Number(l.credit)) : "", costCenterId: l.costCenterId ?? "",
      })),
    };

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="BookText" title={`تعديل قيد ${entry.number}`} subtitle="مسودة — عدّل البنود مع الحفاظ على التوازن ثم احفظ" backHref={`/accounting/journal/${encodeURIComponent(entry.number)}`} />
        <JournalEntryForm accounts={accountList} costCenters={centerList} initial={initial} />
      </div>
    );
  });
}
