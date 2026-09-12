import { and, asc, desc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { bankAccounts, bankStatementLines, accounts, journalEntryLines, journalEntries, salesPlatforms } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { BankStatementClient } from "@/components/erp/bank-statement-client";
import { BankImport, MatchButton } from "@/components/erp/bank-import";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { matchPayouts } from "@/lib/erp/bank-import";
import { PrintDocLink } from "@/components/erp/print/print-doc-link";

const fmt = (n: number) =>
  n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Params = { params: Promise<{ id: string }> };

export default async function BankAccountDetailPage({ params }: Params) {
  return loadErpPage("accounting.view", async ({ orgId, can }) => {
    const { id } = await params;
    const canEdit = can("accounting.create");

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

    // Platform payouts ↔ this account's deposits. Not on a platform's own wallet account:
    // the payout lands there by definition — it's the transfer into a real bank that has
    // to be found. ponytail: a payout is the sum of a settlement's released lines; if
    // Amazon's transfer ever differs (reserves carried over), store the settlement header.
    const [wallet] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
      .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.bankAccountId, id))).limit(1);
    const payouts = wallet ? [] : (await db.execute<{ id: string; channel: string; amount: string; date: string }>(sql`
      SELECT settlement_id AS id, max(channel) AS channel, sum(total) AS amount, max(posted_at) AS date
      FROM marketplace_settlement_txns
      WHERE organization_id = ${orgId} AND status = 'Released'
      GROUP BY settlement_id HAVING sum(total) > 0
      ORDER BY max(posted_at) DESC LIMIT 20
    `)).rows.map((p) => ({ id: p.id, channel: p.channel, amount: Math.round(Number(p.amount) * 100) / 100, date: new Date(p.date) }));
    const matches = matchPayouts(payouts, lines.filter((l) => Number(l.debit) > 0).map((l) => ({ id: l.id, date: l.date, moneyIn: Number(l.debit) })));
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
          backHref="/accounting/banks"
          action={<PrintDocLink href={`/erp/accounting/banks/${id}/print`} />}
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

        {canEdit && <BankImport bankAccountId={id} />}

        {payouts.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>تحويلات المنصات</CardTitle>
              <CardDescription>كل تسوية من أمازون أو نون قصاد الإيداع اللي بنفس المبلغ في الكشف (في حدود ٧ أيام). دوس «طابق» لما يكون هو فعلاً.</CardDescription>
            </CardHeader>
            <CardContent>
              {lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">استورد كشف الحساب الأول — بعدها هنلاقي كل تحويل في الكشف.</p>
              ) : (
                <div className="divide-y">
                  {payouts.map((p) => {
                    const dep = matches.get(p.id);
                    const line = dep ? lineById.get(dep.id) : undefined;
                    return (
                      <div key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                        <span className="w-14 text-muted-foreground">{p.channel === "NOON" ? "نون" : "أمازون"}</span>
                        <span className="font-mono text-xs" dir="ltr">{p.id}</span>
                        <span className="font-medium tabular-nums">{fmt(p.amount)}</span>
                        <span className="tabular-nums text-muted-foreground">{ymd(p.date)}</span>
                        <span className="ms-auto flex items-center gap-2">
                          {!line ? (
                            <span className="text-amber-600 dark:text-amber-400">لسه ماظهرش في الكشف</span>
                          ) : line.isReconciled ? (
                            <span className="text-emerald-600 dark:text-emerald-400">مطابق ✓ إيداع {ymd(line.date)}</span>
                          ) : (
                            <>
                              <span className="text-muted-foreground">إيداع {ymd(line.date)}</span>
                              {canEdit && <MatchButton lineId={line.id} />}
                            </>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
  });
}
