"use client";

import { useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2, Copy } from "lucide-react";
import { saveIntegrationSettingsAction } from "@/app/actions/admin/platform-settings";
import { getNoonWebhookInfo, regenerateNoonWebhookAction } from "@/app/actions/erp/noon-webhook";
import type { IntegrationField } from "@/lib/erp/marketplace/connector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type TextKey = "clientId" | "appId" | "scopes" | "apiVersion" | "region" | "redirectUri";
export type IntegrationInitial = {
  text: Record<TextKey, string>;
  has: { clientSecret: boolean; webhookSecret: boolean };
  enabled: boolean;
  configured: boolean;
};

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(value); toast.success("تم النسخ"); }}
        className="flex w-full items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-start font-mono text-xs hover:bg-accent" dir="ltr">
        <span className="truncate">{value}</span><Copy className="size-3.5 shrink-0" />
      </button>
    </div>
  );
}

/**
 * Generic connector integration form — renders whatever fields the connector declares in
 * configFields, plus an enable toggle and (for OAuth connectors) an editable Redirect URI.
 * Secrets are write-only: a blank secret input keeps the stored value. One component serves
 * every marketplace connector, so adding a connector needs no new admin form.
 */
export function IntegrationSettingsForm({ code, label, fields, hasOAuth, appUrl, initial }: {
  code: string; label: string; fields: IntegrationField[]; hasOAuth: boolean; appUrl: string; initial: IntegrationInitial;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  // Text fields prefill from stored values; secret fields start blank (write-only).
  const [text, setText] = useState<Record<string, string>>({ ...initial.text });
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const base = (appUrl || "").replace(/\/$/, "");
  const defaultRedirect = `${base}/api/erp/marketplace/${code.toLowerCase()}/callback`;

  // Noon webhook: owner-only, auto-generated secret. Revealed/rotated on demand so the
  // secret never sits in the page HTML.
  const webhookUrl = `${base}/api/erp/marketplace/noon/webhook`;
  const [whSecret, setWhSecret] = useState<string | null>(null);
  const [whBusy, setWhBusy] = useState(false);
  const revealSecret = () => start(async () => {
    setWhBusy(true);
    const r = await getNoonWebhookInfo();
    setWhSecret(r.secret || "");
    if (!r.secret) toast.info("لم يُولَّد سرّ بعد — اضغط «تجديد السرّ»");
    setWhBusy(false);
  });
  const regenSecret = () => start(async () => {
    setWhBusy(true);
    const r = await regenerateNoonWebhookAction();
    if (r.ok) { setWhSecret(r.secret); toast.success(r.note ?? (r.registered ? t("تم تجديد السرّ وإعادة التسجيل") : t("تم تجديد السرّ"))); }
    else toast.error(r.error);
    setWhBusy(false);
  });

  const setField = (key: string, secret: boolean, v: string) =>
    secret ? setSecrets((s) => ({ ...s, [key]: v })) : setText((t) => ({ ...t, [key]: v }));

  const save = () => start(async () => {
    const r = await saveIntegrationSettingsAction(code, {
      text: { clientId: text.clientId, appId: text.appId, scopes: text.scopes, apiVersion: text.apiVersion, region: text.region, redirectUri: text.redirectUri },
      clientSecret: secrets.clientSecret,
      webhookSecret: secrets.webhookSecret,
      enabled,
    });
    if ("ok" in r) { toast.success(fill(t("تم حفظ إعدادات {0}"), [label])); setSecrets({}); router.refresh(); }
    else toast.error(r.error);
  });

  // Rendered inside the connector dialog (chrome + title live there).
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <span className="text-sm text-muted-foreground">{t("حالة التكامل")}</span>
        <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />{enabled ? t("مُفعّلة") : t("موقوفة")}</label>
      </div>
      {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`${code}-${f.key}`}>{t(f.label)}</Label>
            <Input
              id={`${code}-${f.key}`}
              value={f.secret ? (secrets[f.key] ?? "") : (text[f.key] ?? "")}
              onChange={(e) => setField(f.key, !!f.secret, e.target.value)}
              placeholder={f.secret && initial.has[f.key as "clientSecret" | "webhookSecret"] ? t("••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)") : (f.placeholder ?? "")}
              dir="ltr" autoComplete="off"
            />
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}

        {hasOAuth && (
          <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">{t("رابط التحويل (OAuth Redirect URI) — أضِفه في إعدادات تطبيق المنصّة:")}</div>
            <CopyRow label={t("الافتراضي")} value={defaultRedirect} />
            <div className="space-y-1">
              <Label htmlFor={`${code}-redirectUri`} className="text-xs text-muted-foreground">{t("تجاوز (اختياري) — فارغ يستخدم الافتراضي")}</Label>
              <Input id={`${code}-redirectUri`} value={text.redirectUri ?? ""} onChange={(e) => setText((t) => ({ ...t, redirectUri: e.target.value }))} placeholder={defaultRedirect} dir="ltr" autoComplete="off" />
            </div>
          </div>
        )}

      {code === "NOON" && (
        <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">{t("ويب‌هوك نون (طلبات + مرتجعات)")}</div>
          <p className="text-xs text-muted-foreground">{t("السرّ بيتولّد تلقائيًا. نون ما بتتيحش تسجيلًا تلقائيًا عبر API، فانسخ القيم دي وسجّلها")} <b>{t("مرة واحدة")}</b> {t("في بوابة نون: Event Notifications → Destinations → Create Destination. العميل ما بيشوفش الجزء ده.")}</p>
          <CopyRow label="Destination URL" value={webhookUrl} />
          <CopyRow label="Credentials · Key" value="key" />
          {whSecret !== null && whSecret !== "" && <CopyRow label={t("Credentials · Value (السرّ)")} value={whSecret} />}
          <div className="flex flex-wrap items-center gap-2">
            {whSecret === null && (
              <Button type="button" variant="outline" size="sm" onClick={revealSecret} disabled={whBusy}>
                {whBusy && <Loader2 className="size-3.5 animate-spin" />}{t("إظهار السرّ")}
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={regenSecret} disabled={whBusy}>
              {whBusy && <Loader2 className="size-3.5 animate-spin" />}{t("تجديد السرّ")}
            </Button>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("مفاتيح التطبيق (تطبيق واحد يخدم كل العملاء). تُخزَّن الأسرار مشفّرة. اترك حقل السر فارغًا للإبقاء على المحفوظ.")}</p>
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ الإعدادات")}</Button>
      </div>
    </div>
  );
}
