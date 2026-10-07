import { and, asc, eq } from "drizzle-orm";
import { getT } from "@/lib/i18n/server";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, costCenters } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { JournalEntryForm } from "@/components/erp/journal-entry-form";

export default async function NewJournalEntryPage() {
  const t = await getT();
  return loadErpPage("accounting.create", async ({ orgId }) => {
    const [accountList, centerList] = await Promise.all([
      db
        .select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr })
        .from(accounts)
        .where(
          and(
            eq(accounts.organizationId, orgId),
            eq(accounts.isLeaf, true),
            eq(accounts.isActive, true),
            eq(accounts.allowManualEntries, true),
          ),
        )
        .orderBy(asc(accounts.code)),
      db
        .select({ id: costCenters.id, code: costCenters.code, nameAr: costCenters.nameAr })
        .from(costCenters)
        .where(and(eq(costCenters.organizationId, orgId), eq(costCenters.isActive, true)))
        .orderBy(asc(costCenters.code)),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="BookText" title={t("قيد يومية جديد")} subtitle={t("قيد محاسبي يدوي متوازن")} backHref="/accounting/journal" />
        <JournalEntryForm accounts={accountList} costCenters={centerList} />
      </div>
    );
  });
}
