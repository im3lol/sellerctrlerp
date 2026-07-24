import { and, asc, eq } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { accounts, accountingConfigurations } from "@/db/schema";
import { ErpPageHeader } from "@/components/erp/page-header";
import { SettingsForm, type AccountOption, type AccountingConfig, type OrgProfile } from "@/components/erp/settings-form";

// ponytail: SettingsForm requires a profile even for the accounting-only section — feed an empty one.
const EMPTY_PROFILE: OrgProfile = {
  nameAr: "", nameEn: "", legalName: null, taxNumber: null, address: null, phone: null,
  email: null, logo: null, vatRate: "14", fiscalYearStart: null, poApprovalThreshold: "0",
};

export default async function AccountingSettingsPage() {
  return loadErpPage("settings.view", async ({ orgId, can }) => {
    const [accs, [config]] = await Promise.all([
      db.select({ id: accounts.id, code: accounts.code, nameAr: accounts.nameAr, type: accounts.type })
        .from(accounts)
        .where(and(eq(accounts.organizationId, orgId), eq(accounts.isActive, true)))
        .orderBy(asc(accounts.code)),
      db.select().from(accountingConfigurations).where(eq(accountingConfigurations.organizationId, orgId)).limit(1),
    ]);

    const accountOptions: AccountOption[] = accs;
    const accountingConfig: AccountingConfig = config
      ? {
          receivableAccountId: config.receivableAccountId,
          payableAccountId: config.payableAccountId,
          cashAccountId: config.cashAccountId,
          bankAccountId: config.bankAccountId,
          salesAccountId: config.salesAccountId,
          purchaseAccountId: config.purchaseAccountId,
          outputTaxAccountId: config.outputTaxAccountId,
          inputTaxAccountId: config.inputTaxAccountId,
          inventoryAccountId: config.inventoryAccountId,
          cogsAccountId: config.cogsAccountId,
          grniAccountId: config.grniAccountId,
          salesReturnsAccountId: config.salesReturnsAccountId,
          inventorySurplusAccountId: config.inventorySurplusAccountId,
          inventoryDeficitAccountId: config.inventoryDeficitAccountId,
          purchaseReturnVarianceAccountId: config.purchaseReturnVarianceAccountId,
          openingEquityAccountId: config.openingEquityAccountId,
          amazonClearingAccountId: config.amazonClearingAccountId,
          amazonFeesAccountId: config.amazonFeesAccountId,
          assetDisposalGainAccountId: config.assetDisposalGainAccountId,
          assetDisposalLossAccountId: config.assetDisposalLossAccountId,
        }
      : null;

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="Calculator" title="الضبط المحاسبي" subtitle="الحسابات الافتراضية التي تُرحَّل إليها المستندات تلقائياً" backHref="/settings" />
        <SettingsForm section="accounting" profile={EMPTY_PROFILE} config={accountingConfig} accounts={accountOptions} canEdit={can("settings.edit")} />
      </div>
    );
  });
}
