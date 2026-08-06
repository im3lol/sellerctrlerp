import { PageHeader } from "@/components/page-header";
import { getXpaySettingsAdmin, getEmailSettingsAdmin, getIntegrationSettingsAdmin } from "@/app/actions/admin/platform-settings";
import { registeredConnectors } from "@/lib/erp/marketplace/registry";
import { IntegrationSettingsForm } from "@/components/admin/integration-settings-form";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";
import { EmailSettingsForm } from "@/components/admin/email-settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  // Every registered connector that declares config fields renders a generic form — a new
  // connector appears here automatically with no page change.
  const connectors = registeredConnectors().filter((c) => c.configFields?.length);
  const [initials, xpay, email] = await Promise.all([
    Promise.all(connectors.map((c) => getIntegrationSettingsAdmin(c.code))),
    getXpaySettingsAdmin(),
    getEmailSettingsAdmin(),
  ]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="space-y-6">
      <PageHeader title="التكاملات" description="منصّات البيع، بوابات الدفع، ومفاتيح الربط والبريد على مستوى المنصّة." />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
        {connectors.map((c, i) => (
          <IntegrationSettingsForm key={c.code} code={c.code} label={c.label} fields={c.configFields!} hasOAuth={!!c.oauth} appUrl={appUrl} initial={initials[i]} />
        ))}
        <XpaySettingsForm initial={xpay} appUrl={appUrl} />
        <EmailSettingsForm initial={email} />
      </div>
    </div>
  );
}
