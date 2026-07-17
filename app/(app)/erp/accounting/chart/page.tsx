import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, journalEntries, journalEntryLines } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AccountsTree } from "@/components/erp/accounts-tree";

export default async function ChartOfAccountsPage() {
  return loadErpPage("accounting.view", async ({ orgId, role, can }) => {
    const [rows, balRows] = await Promise.all([
      db
        .select({
          id: accounts.id,
          code: accounts.code,
          nameAr: accounts.nameAr,
          nameEn: accounts.nameEn,
          type: accounts.type,
          normalBalance: accounts.normalBalance,
          parentId: accounts.parentId,
          isLeaf: accounts.isLeaf,
          isActive: accounts.isActive,
        })
        .from(accounts)
        .where(eq(accounts.organizationId, orgId))
        .orderBy(asc(accounts.code)),
      db
        .select({
          accountId: journalEntryLines.accountId,
          net: sql<string>`coalesce(sum(${journalEntryLines.debit} - ${journalEntryLines.credit}), 0)`,
        })
        .from(journalEntryLines)
        .innerJoin(
          journalEntries,
          and(
            eq(journalEntries.id, journalEntryLines.journalEntryId),
            eq(journalEntries.organizationId, orgId),
            eq(journalEntries.status, "POSTED"),
          ),
        )
        .groupBy(journalEntryLines.accountId),
    ]);

    const balances = Object.fromEntries(balRows.map((r) => [r.accountId, Number(r.net)]));
    const leafCount = rows.filter((r) => r.isLeaf).length;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="Calculator"
          title="دليل الحسابات"
          subtitle={`${rows.length} حساب (${leafCount} تفصيلي)`}
          backHref="/erp/accounting"
        />
        <AccountsTree accounts={rows} balances={balances} canManage={can("accounting.create")} />
      </div>
    );
  });
}
