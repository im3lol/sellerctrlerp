import { and, eq, gte, sql } from "drizzle-orm";
import { fill } from "@/lib/i18n";
import { getT } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { aiCaptures, organizations, platformSettings } from "@/db/schema";
import { loadErpPage } from "@/lib/erp/org";
import { AI_MODELS } from "@/lib/erp/ai-bill";
import { ErpPageHeader } from "@/components/erp/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/icon";
import { OrgAiKeyForm } from "@/components/erp/org-ai-key-form";

export const dynamic = "force-dynamic";

export default async function AiSettingsPage() {
  const t = await getT();
  return loadErpPage("settings.view", async ({ orgId, can }) => {
    const [org] = await db.select({ key: organizations.aiApiKey, model: organizations.aiModel }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    const [ps] = await db.select({ key: platformSettings.aiApiKey, model: platformSettings.aiModel, limit: platformSettings.aiMonthlyLimit }).from(platformSettings).limit(1);
    const start = new Date(); start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
    const usage = await db.select({ own: aiCaptures.ownKey, n: sql<number>`count(*)::int` }).from(aiCaptures)
      .where(and(eq(aiCaptures.organizationId, orgId), eq(aiCaptures.status, "DONE"), gte(aiCaptures.createdAt, start)))
      .groupBy(aiCaptures.ownKey);
    const used = (own: boolean) => usage.find((u) => u.own === own)?.n ?? 0;
    const platformOn = !!ps?.key && !!ps.model;
    const modelLabel = (id: string | null | undefined) => AI_MODELS.find((m) => m.id === id)?.label ?? "—";
    const int = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");

    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <ErpPageHeader icon="Sparkles" title={t("الذكاء الاصطناعي")} subtitle={t("قراءة فواتير الموردين والإيصالات — بمفتاح المنصة أو بمفتاح شركتك")} backHref="/settings" />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("بتشتغل بإيه دلوقتي")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted-foreground">{t("المفتاح")}</div>
              <div className="font-medium">{org?.key ? t("مفتاح شركتك") : platformOn ? t("مفتاح المنصة") : t("مش مفعّلة")}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("الموديل")}</div>
              <div className="font-medium">{modelLabel(org?.key ? org.model : ps?.model)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("الشهر ده")}</div>
              <div className="font-medium tabular-nums">
                {org?.key ? fill(t("{0} قراءة بمفتاحك"), [int(used(true))]) : platformOn ? fill(t("{0} من {1}"), [int(used(false)), int(ps!.limit)]) : "—"}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("مفتاح شركتك (اختياري)")}</CardTitle>
            <CardDescription>
              {t("لو عندك حساب Anthropic API، حط مفتاحه هنا: القراءات هتتحسب عليك مباشرة ومفيش حد شهري من المنصة، وتختار الموديل اللي يناسبك. اشتراك Claude العادي (Pro / Max) مابيشتغلش هنا — لازم مفتاح API من console.anthropic.com.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {can("settings.edit")
              ? <OrgAiKeyForm hasKey={!!org?.key} model={org?.model ?? ""} />
              : <p className="text-sm text-muted-foreground">{t("تغيير المفتاح محتاج صلاحية تعديل الإعدادات.")}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base"><Icon name="ShieldCheck" className="size-5 text-primary" />{t("بياناتك في أمان")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 ps-5 text-sm text-muted-foreground">
              <li>{t("الحاجة الوحيدة اللي بتتبعت للذكاء الاصطناعي هي")} <b>{t("ملف الفاتورة اللي انت بترفعه")}</b> {t("— مفيش عملاء ولا أصناف ولا أرصدة ولا أي بيانات تانية من حسابك.")}</li>
              <li>{t("مطابقة المورد والأصناف بتحصل")} <b>{t("عندنا")}</b> {t("بعد القراءة، مش عند الذكاء الاصطناعي.")}</li>
              <li>{t("الذكاء الاصطناعي ماعندوش أي صلاحية يقرا أو يكتب في النظام — بيرجّع بيانات الفاتورة بس، وانت اللي بتقرر تتحوّل لإيه.")}</li>
              <li>{t("مفتاحك بيتخزن")} <b>{t("مشفّر")}</b>{t("، ومش بيظهر تاني لأي حد ولا بيتسجّل في أي لوج، وبيتستخدم لطلبات شركتك بس. أي تغيير فيه بيتسجّل في سجل التدقيق.")}</li>
              <li>{t("Anthropic مابتستخدمش بيانات الـAPI في تدريب موديلاتها بشكل افتراضي.")}</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    );
  });
}
