import { and, asc, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, accounts, journalEntryLines, journalEntries } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BankStatementClient } from "@/components/erp/bank-statement-client";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Params = { params: Promise<{ id: string }> };

export default async function BankAccountDetailPage({ params }: Params) {
  const { orgId, role } = await requireErpModule("accounting.view");
  const { id } = await params;
  const canEdit = erpCan(role, "accounting.create");

  const [ba] = await db
    .select({
      id: bankAccounts.id,
      nameAr: bankAccounts.nameAr,
      bankName: bankAccounts.bankName,
      iban: bankAccounts.iban,
      accountNumber: bankAccounts.accountNumber,
      glAccountId: bankAccounts.glAccountId,
      glCode: accounts.code,
      glName: accounts.nameAr,
    })
    .from(bankAccounts)
    .leftJoin(accounts, eq(accounts.id, bankAccounts.glAccountId))
    .where(and(eq(bankAccounts.id, id), eq(bankAccounts.organizationId, orgId)));

  if (!ba) notFound();

  const lines = await db
    .select({
      id: bankStatementLines.id,
      date: bankStatementLines.date,
      description: bankStatementLines.description,
      reference: bankStatementLines.reference,
      debit: bankStatementLines.debit,
      credit: bankStatementLines.credit,
      isReconciled: bankStatementLines.isReconciled,
      journalEntryId: bankStatementLines.journalEntryId,
    })
    .from(bankStatementLines)
    .where(and(eq(bankStatementLines.bankAccountId, id), eq(bankStatementLines.organizationId, orgId)))
    .orderBy(asc(bankStatementLines.date), desc(bankStatementLines.createdAt));

  // GL entries for the linked account (for reconciliation suggestion)
  const glLines = ba.glAccountId
    ? await db
        .select({
          id: journalEntryLines.id,
          date: journalEntries.date,
          description: journalEntries.description,
          number: journalEntries.number,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalEntryLines.journalEntryId))
        .where(
          and(
            eq(journalEntryLines.accountId, ba.glAccountId!),
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.status, "POSTED"),
          ),
        )
        .orderBy(desc(journalEntries.date))
        .limit(100)
    : [];

  const totalIn  = lines.reduce((s, l) => s + Number(l.debit),  0);
  const totalOut = lines.reduce((s, l) => s + Number(l.credit), 0);
  const balance  = totalIn - totalOut;
  const unrec    = lines.filter((l) => !l.isReconciled).length;

  const glBalance = glLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  const diff = balance - glBalance;

  return (
    <div className="space-y-6" dir="rtl">
      <ErpPageHeader
        icon="Landmark"
        title={ba.nameAr}
        subtitle={[ba.bankName, ba.iban].filter(Boolean).join(" · ") || "كشف الحساب البنكي"}
        backHref="/erp/accounting/banks"
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "إجمالي الوارد",     value: fmt(totalIn),    cls: "text-emerald-600 dark:text-emerald-400" },
          { label: "إجمالي الصادر",     value: fmt(totalOut),   cls: "text-red-600 dark:text-red-400" },
          { label: "رصيد الكشف",        value: fmt(balance),    cls: balance < 0 ? "text-red-600 dark:text-red-400" : "" },
          ...(ba.glAccountId
            ? [{ label: `فرق التسوية${diff !== 0 ? " ⚠" : ""}`, value: fmt(Math.abs(diff)), cls: diff !== 0 ? "text-amber-600 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400" }]
            : [{ label: "غير مسوّى",    value: String(unrec),   cls: unrec > 0 ? "text-amber-600 dark:text-amber-400" : "" }]
          ),
        ].map((t, i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">{t.label}</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${t.cls}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <BankStatementClient
        bankAccountId={id}
        lines={lines.map((l) => ({
          id: l.id,
          date: l.date.toISOString().slice(0, 10),
          description: l.description ?? "",
          reference: l.reference ?? "",
          debit: Number(l.debit),
          credit: Number(l.credit),
          isReconciled: l.isReconciled,
        }))}
        glLines={glLines.map((l) => ({
          id: l.id,
          date: l.date.toISOString().slice(0, 10),
          number: l.number,
          description: l.description ?? "",
          debit: Number(l.debit),
          credit: Number(l.credit),
        }))}
        canEdit={canEdit}
      />
    </div>
  );
}
