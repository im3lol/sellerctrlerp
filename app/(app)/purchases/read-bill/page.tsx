import Link from "next/link";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, organizations, platformSettings } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { ErpPageHeader } from "@/components/erp/page-header";
import { AiBillReader } from "@/components/erp/ai-bill-reader";

export const dynamic = "force-dynamic";

export default async function ReadBillPage() {
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    // Ready when the company brought its own key, or the owner has set a key and picked a model.
    const [org] = await db.select({ key: organizations.aiApiKey }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const [ps] = await db.select({ key: platformSettings.aiApiKey, model: platformSettings.aiModel }).from(platformSettings).limit(1);
    const ready = !!org?.key || (!!ps?.key && !!ps.model);

    const canExpense = can("accounting.create");
    const pick = (where: ReturnType<typeof and>) => db.select({ id: accounts.id, code: accounts.code, name: accounts.nameAr })
      .from(accounts).where(where).orderBy(asc(accounts.code));
    const expenseAccounts = canExpense ? await pick(and(eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "EXPENSE"))) : [];
    const cashAccounts = canExpense ? await pick(and(
      eq(accounts.organizationId, orgId), eq(accounts.isLeaf, true), eq(accounts.isActive, true), eq(accounts.type, "ASSET"),
      sql`(${accounts.code} LIKE '1101%' OR ${accounts.code} LIKE '1102%')`,
    )) : [];

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ScanText" title="قراءة فاتورة بالذكاء الاصطناعي" backHref="/purchases/invoices"
          subtitle="ارفع فاتورة مورد أو إيصال — بتتقري وتتحوّل لمسودة تراجعها قبل ما تتسجل" />
        {ready ? (
          <AiBillReader canInvoice={can("purchases.create")} canExpense={canExpense}
            expenseAccounts={expenseAccounts} cashAccounts={cashAccounts} />
        ) : (
          <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            قراءة الفواتير لسه مش مفعّلة على المنصة.
            {can("settings.edit") && <> تقدر تشغّلها دلوقتي بمفتاح شركتك من <Link href="/settings/ai" className="text-primary underline">إعدادات الذكاء الاصطناعي</Link>.</>}
          </div>
        )}
      </div>
    );
  });
}
