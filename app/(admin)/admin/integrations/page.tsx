import { getPageNotice } from "@/lib/ui-notice";
import { NoticeConsumed } from "@/components/ui/notice-consumed";
import { PageHeader } from "@/components/page-header";
import { getT } from "@/lib/i18n/server";
import { getXpaySettingsAdmin, getEmailSettingsAdmin, getIntegrationSettingsAdmin, getAiSettingsAdmin, getTelegramSettingsAdmin } from "@/app/actions/admin/platform-settings";
import { AiSettingsForm } from "@/components/admin/ai-settings-form";
import { registeredConnectors } from "@/lib/erp/marketplace/registry";
import { IntegrationCard } from "@/components/admin/integration-card";
import { SettingsTile } from "@/components/admin/settings-tile";
import { XpaySettingsForm } from "@/components/admin/xpay-settings-form";
import { EmailSettingsForm } from "@/components/admin/email-settings-form";
import { TelegramSettingsForm } from "@/components/admin/telegram-settings-form";
import { StorageCloudSetup } from "@/components/erp/storage-cloud-setup";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ cloudSaved?: string; cloudError?: string }> }) {
  const t = await getT();
  const notice = await getPageNotice("/admin/integrations");
  const params = { ...await searchParams, ...notice.values };
  // Every registered connector that declares config fields shows a tile — click to connect.
  // A new connector appears automatically with no page change.
  const connectors = registeredConnectors().filter((c) => c.configFields?.length);
  const [initials, xpay, email, ai, telegram] = await Promise.all([
    Promise.all(connectors.map((c) => getIntegrationSettingsAdmin(c.code))),
    getXpaySettingsAdmin(),
    getEmailSettingsAdmin(),
    getAiSettingsAdmin(),
    getTelegramSettingsAdmin(),
  ]);
  const appUrl = process.env.APP_URL ?? "";
  return (
    <div className="space-y-8">
        <NoticeConsumed path={"/admin/integrations"} id={notice.id} />
      <PageHeader title={t("التكاملات")} description={t("منصّات البيع، بوابات الدفع، ومفاتيح الربط والبريد على مستوى المنصّة.")} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("منصّات البيع")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {connectors.map((c, i) => (
            <IntegrationCard key={c.code} code={c.code} label={c.label} fields={c.configFields!} hasOAuth={!!c.oauth} appUrl={appUrl} initial={initials[i]} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("الدفع والبريد")}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SettingsTile label={t("بوابة الدفع xpay")} icon="CreditCard" brandCls="bg-indigo-500/15 text-indigo-600" configured={xpay.hasSecretKey}
            dialogTitle={t("بوابة الدفع xpay")} dialogDescription={t("مفاتيح حساب xpay لتحصيل الاشتراكات أونلاين.")}>
            <XpaySettingsForm initial={xpay} appUrl={appUrl} />
          </SettingsTile>
          <SettingsTile label={t("البريد الإلكتروني (SMTP)")} icon="Mail" brandCls="bg-sky-500/15 text-sky-600" configured={email.hasPass}
            dialogTitle={t("البريد الإلكتروني (SMTP)")} dialogDescription={t("خادم SMTP لرسائل الترحيب والإيصالات والتذكيرات.")}>
            <EmailSettingsForm initial={email} />
          </SettingsTile>
          <SettingsTile label={t("تليجرام والتنبيهات")} icon="Send" brandCls="bg-cyan-500/15 text-cyan-600" configured={telegram.hasBotToken && telegram.hasAlertChatId}
            dialogTitle={t("تليجرام والتنبيهات")} dialogDescription={t("بوت واحد للتنبيهات التشغيلية وموافقات الفريق.")}>
            <TelegramSettingsForm initial={telegram} appUrl={appUrl} />
          </SettingsTile>
          <SettingsTile label={t("الذكاء الاصطناعي (قراءة الفواتير)")} icon="Sparkles" brandCls="bg-violet-500/15 text-violet-600" configured={ai.hasKey && !!ai.model}
            dialogTitle={t("الذكاء الاصطناعي")} dialogDescription={t("مفتاح Anthropic والموديل والحد الشهري لكل شركة.")}>
            <AiSettingsForm initial={ai} />
          </SettingsTile>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">{t("التخزين السحابي")}</h2>
        {params.cloudSaved && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{t("تم حفظ إعداد Google Drive")}</p>}
        {params.cloudError && <p role="alert" className="rounded-xl border border-destructive p-4 text-sm">{t("راجع Client ID وClient Secret وأعد المحاولة")}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><StorageCloudSetup source="admin-integrations" defaultOpen={!!params.cloudError} /></div>
      </section>
    </div>
  );
}
