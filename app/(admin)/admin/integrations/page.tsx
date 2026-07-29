import { PageHeader } from "@/components/page-header";
import { getXpaySettingsAdmin, getShopifySettingsAdmin } from "@/app/actions/admin/platform-settings";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";
import { ShopifySettingsForm } from "@/components/admin/shopify-settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [xpay, shopify] = await Promise.all([getXpaySettingsAdmin(), getShopifySettingsAdmin()]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="التكاملات" description="بوابات الدفع ومفاتيح الربط على مستوى المنصّة." />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <XpaySettingsForm initial={xpay} appUrl={appUrl} />
        <ShopifySettingsForm initial={shopify} appUrl={appUrl} />
      </div>
    </div>
  );
}
