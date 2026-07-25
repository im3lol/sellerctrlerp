import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, accounts } from "@/db/schema";
import { fmt, dt, money } from "@/lib/erp/print-format";
import { loadPrintHeader } from "@/lib/erp/print-org";
import { DocumentSheet } from "@/components/erp/print/document-sheet";

type Params = { params: Promise<{ id: string }> };

export default async function PrintBankAccountPage({ params }: Params) {
  const { id } = await params;
  return loadErpPage("accounting.view", async ({ orgId }) => {
    const [ba] = await db
      .select({
        nameAr: bankAccounts.nameAr,
        bankName: bankAccounts.bankName,
        iban: bankAccounts.iban,
        accountNumber: bankAccounts.accountNumber,
        glCode: accounts.code,
        glName: accounts.nameAr,
      })
      .from(bankAccounts)
      .leftJoin(accounts, eq(accounts.id, bankAccounts.glAccountId))
      .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));
    if (!ba) notFound();

    const [{ org, currency, footerText }, lines] = await Promise.all([
      loadPrintHeader(orgId),
      db
        .select({
          date: bankStatementLines.date,
          description: bankStatementLines.description,
          debit: bankStatementLines.debit,
          credit: bankStatementLines.credit,
        })
        .from(bankStatementLines)
        .where(and(eq(bankStatementLines.bankAccountId, id), eq(bankStatementLines.organizationId, orgId)))
        .orderBy(asc(bankStatementLines.date), desc(bankStatementLines.createdAt)),
    ]);

    const totalIn = lines.reduce((s, l) => s + Number(l.debit), 0);
    const totalOut = lines.reduce((s, l) => s + Number(l.credit), 0);

    // Running balance per line, same asc-date order as the on-screen statement.
    let run = 0;
    const rows = lines.map((l) => {
      run += Number(l.debit) - Number(l.credit);
      return [
        dt(l.date),
        l.description || "—",
        Number(l.debit) ? fmt(l.debit) : "—",
        Number(l.credit) ? fmt(l.credit) : "—",
        fmt(run),
      ];
    });

    return (
      <DocumentSheet
        org={org}
        footerText={footerText}
        title="بيان حساب بنكي"
        number={ba.accountNumber || ba.iban || ba.nameAr}
        backHref={`/accounting/banks/${id}`}
        meta={[
          { label: "اسم الحساب", value: ba.nameAr },
          ...(ba.bankName ? [{ label: "البنك", value: ba.bankName }] : []),
          ...(ba.iban ? [{ label: "الآيبان", value: ba.iban }] : []),
          ...(ba.glCode ? [{ label: "حساب الأستاذ", value: `${ba.glCode} — ${ba.glName}` }] : []),
        ]}
        columns={rows.length ? [
          { label: "التاريخ", width: "18%" },
          { label: "البيان", width: "34%" },
          { label: "مدين", align: "end", width: "16%" },
          { label: "دائن", align: "end", width: "16%" },
          { label: "الرصيد", align: "end", width: "16%" },
        ] : []}
        rows={rows}
        totals={[
          { label: "إجمالي الوارد", value: money(totalIn, currency) },
          { label: "إجمالي الصادر", value: money(totalOut, currency) },
        ]}
        balance={{ label: "الرصيد الحالي", value: money(totalIn - totalOut, currency) }}
      />
    );
  });
}
