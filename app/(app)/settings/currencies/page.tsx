import { desc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { currencies, exchangeRates } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { CurrenciesManager } from "@/components/erp/currencies-manager";

export default async function CurrenciesPage() {
  return loadErpPage("settings.view", async ({ orgId }) => {
    const [currencyRows, rateRows] = await Promise.all([
      db
        .select({
          id: currencies.id,
          code: currencies.code,
          nameAr: currencies.nameAr,
          symbol: currencies.symbol,
          isBase: currencies.isBase,
          isActive: currencies.isActive,
          exchangeRate: currencies.exchangeRate,
        })
        .from(currencies)
        .where(eq(currencies.organizationId, orgId))
        .orderBy(currencies.isBase, currencies.code),

      db
        .select({
          id: exchangeRates.id,
          currencyCode: exchangeRates.currencyCode,
          date: exchangeRates.date,
          rate: exchangeRates.rate,
        })
        .from(exchangeRates)
        .where(eq(exchangeRates.organizationId, orgId))
        .orderBy(desc(exchangeRates.date))
        .limit(50),
    ]);

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="BadgeDollarSign"
          title="العملات وأسعار الصرف"
          subtitle="حدّد العملات المستخدمة وأدخل أسعار الصرف اليومية."
          backHref="/settings"
        />
        <CurrenciesManager currencies={currencyRows} rates={rateRows} />
      </div>
    );
  });
}
