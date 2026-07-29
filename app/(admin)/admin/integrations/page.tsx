import { PageHeader } from "@/components/page-header";
import { getXpaySettingsAdmin } from "@/app/actions/admin/platform-settings";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const xpay = await getXpaySettingsAdmin();
  return (
    <div className="space-y-6">
      <PageHeader title="التكاملات" description="بوابات الدفع ومفاتيح الربط على مستوى المنصّة." />
      <div className="max-w-2xl">
        <XpaySettingsForm initial={xpay} appUrl={process.env.APP_URL ?? ""} />
      </div>
    </div>
  );
}
