import { PageHeader } from "@/components/page-header";
import { getXpaySettingsAdmin, getEmailSettingsAdmin, getIntegrationSettingsAdmin } from "@/app/actions/admin/platform-settings";
import { registeredConnectors } from "@/lib/erp/marketplace/registry";
import { IntegrationCard } from "@/components/admin/integration-card";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";
import { EmailSettingsForm } from "@/components/admin/email-settings-form";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  // Every registered connector that declares config fields shows a tile — click to connect.
  // A new connector appears automatically with no page change.
  const connectors = registeredConnectors().filter((c) => c.configFields?.length);
  const [initials, xpay, email] = await Promise.all([
    Promise.all(connectors.map((c) => getIntegrationSettingsAdmin(c.code))),
    getXpaySettingsAdmin(),
    getEmailSettingsAdmin(),
  ]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="space-y-8">
      <PageHeader title="التكاملات" description="منصّات البيع، بوابات الدفع، ومفاتيح الربط والبريد على مستوى المنصّة." />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">منصّات البيع</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c, i) => (
            <IntegrationCard key={c.code} code={c.code} label={c.label} fields={c.configFields!} hasOAuth={!!c.oauth} appUrl={appUrl} initial={initials[i]} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">الدفع والبريد</h2>
        <div className="grid max-w-5xl gap-6 lg:grid-cols-2">
          <XpaySettingsForm initial={xpay} appUrl={appUrl} />
          <EmailSettingsForm initial={email} />
        </div>
      </section>
    </div>
  );
}
