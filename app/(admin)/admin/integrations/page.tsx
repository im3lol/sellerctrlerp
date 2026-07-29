import { PageHeader } from "@/components/page-header";
import { getXpaySettingsAdmin, getShopifySettingsAdmin, getEmailSettingsAdmin } from "@/app/actions/admin/platform-settings";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";
import { ShopifySettingsForm } from "@/components/admin/shopify-settings-form";
import { EmailSettingsForm } from "@/components/admin/email-settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const [xpay, shopify, email] = await Promise.all([getXpaySettingsAdmin(), getShopifySettingsAdmin(), getEmailSettingsAdmin()]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="التكاملات" description="بوابات الدفع ومفاتيح الربط والبريد على مستوى المنصّة." />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        <XpaySettingsForm initial={xpay} appUrl={appUrl} />
        <ShopifySettingsForm initial={shopify} appUrl={appUrl} />
        <EmailSettingsForm initial={email} />
      </div>
    </div>
  );
}
