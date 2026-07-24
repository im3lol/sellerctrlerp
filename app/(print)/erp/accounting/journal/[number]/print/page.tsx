import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines, accounts } from "@/db/schema";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

const STATUS: Record<string, string> = {
  DRAFT: "مسودة",
  POSTED: "مرحّل",
  REVERSED: "معكوس",
};
const SOURCE: Record<string, string> = {
  MANUAL: "قيد يدوي",
  SALES_INVOICE: "فاتورة بيع",
  PURCHASE_INVOICE: "فاتورة شراء",
  REVERSAL: "قيد عكسي",
};

type Params = { params: Promise<{ number: string }> };

export default async function PrintJournalEntryPage({ params }: Params) {
  const raw = decodeURIComponent((await params).number);
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const [entry] = await db
      .select()
      .from(journalEntries)
      .where(and(eq(journalEntries.number, raw), eq(journalEntries.organizationId, orgId)))
      .limit(1);
    if (!entry) notFound();

    const [{ org, currency, hiddenFor, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          description: journalEntryLines.description,
          accountCode: accounts.code,
          accountName: accounts.nameAr,
        })
        .from(journalEntryLines)
        .innerJoin(accounts, eq(accounts.id, journalEntryLines.accountId))
        .where(eq(journalEntryLines.journalEntryId, entry.id)),
    ]);

    const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);

    return (
      <DocumentSheet
        org={org}
        hiddenColumns={hiddenFor("journal")}
        footerText={footerText}
        title="قيد يومية"
        number={entry.number}
        backHref={`/accounting/journal/${encodeURIComponent(raw)}`}
        watermark={entry.status === "DRAFT" ? "مسودة" : undefined}
        meta={[
          { label: "التاريخ", value: dt(entry.date) },
          { label: "المصدر", value: SOURCE[entry.sourceType ?? ""] ?? "قيد محاسبي" },
          { label: "الحالة", value: STATUS[entry.status] ?? entry.status },
          ...(entry.reference ? [{ label: "المرجع", value: entry.reference }] : []),
        ]}
        columns={[
          { label: "الحساب", width: "38%" },
          { label: "البيان", width: "30%" },
          { label: "مدين", align: "end", width: "16%" },
          { label: "دائن", align: "end", width: "16%" },
        ]}
        rows={lines.map((l, i) => [
          <span key={i}>
            <span dir="ltr" style={{ color: "#8a93a6", fontSize: 10.5, marginInlineEnd: 6 }}>{l.accountCode}</span>
            <b>{l.accountName}</b>
          </span>,
          l.description || "—",
          Number(l.debit) ? fmt(l.debit) : "—",
          Number(l.credit) ? fmt(l.credit) : "—",
        ])}
        totals={[
          { label: "إجمالي المدين", value: money(totalDebit, currency), tone: "strong" },
          { label: "إجمالي الدائن", value: money(totalCredit, currency), tone: "strong" },
        ]}
        note={entry.description}
        signatures={["المحاسب", "المدير المالي"]}
      />
    );
  });
}
