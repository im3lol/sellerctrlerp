"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy } from "lucide-react";
import { saveIntegrationSettingsAction } from "@/app/actions/admin/platform-settings";
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
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  // Text fields prefill from stored values; secret fields start blank (write-only).
  const [text, setText] = useState<Record<string, string>>({ ...initial.text });
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const base = (appUrl || "").replace(/\/$/, "");
  const defaultRedirect = `${base}/api/erp/marketplace/${code.toLowerCase()}/callback`;

  const setField = (key: string, secret: boolean, v: string) =>
    secret ? setSecrets((s) => ({ ...s, [key]: v })) : setText((t) => ({ ...t, [key]: v }));

  const save = () => start(async () => {
    const r = await saveIntegrationSettingsAction(code, {
      text: { clientId: text.clientId, appId: text.appId, scopes: text.scopes, apiVersion: text.apiVersion, region: text.region, redirectUri: text.redirectUri },
      clientSecret: secrets.clientSecret,
      webhookSecret: secrets.webhookSecret,
      enabled,
    });
    if ("ok" in r) { toast.success(`تم حفظ إعدادات ${label}`); setSecrets({}); router.refresh(); }
    else toast.error(r.error);
  });

  // Rendered inside the connector dialog (chrome + title live there).
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/20 px-3 py-2">
        <span className="text-sm text-muted-foreground">حالة التكامل</span>
        <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />{enabled ? "مُفعّلة" : "موقوفة"}</label>
      </div>
      {fields.map((f) => (
          <div key={f.key} className="space-y-2">
            <Label htmlFor={`${code}-${f.key}`}>{f.label}</Label>
            <Input
              id={`${code}-${f.key}`}
              value={f.secret ? (secrets[f.key] ?? "") : (text[f.key] ?? "")}
              onChange={(e) => setField(f.key, !!f.secret, e.target.value)}
              placeholder={f.secret && initial.has[f.key as "clientSecret" | "webhookSecret"] ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : (f.placeholder ?? "")}
              dir="ltr" autoComplete="off"
            />
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}

        {hasOAuth && (
          <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
            <div className="text-sm font-medium">رابط التحويل (OAuth Redirect URI) — أضِفه في إعدادات تطبيق المنصّة:</div>
            <CopyRow label="الافتراضي" value={defaultRedirect} />
            <div className="space-y-1">
              <Label htmlFor={`${code}-redirectUri`} className="text-xs text-muted-foreground">تجاوز (اختياري) — فارغ يستخدم الافتراضي</Label>
              <Input id={`${code}-redirectUri`} value={text.redirectUri ?? ""} onChange={(e) => setText((t) => ({ ...t, redirectUri: e.target.value }))} placeholder={defaultRedirect} dir="ltr" autoComplete="off" />
            </div>
          </div>
        )}

      <p className="text-xs text-muted-foreground">مفاتيح التطبيق (تطبيق واحد يخدم كل العملاء). تُخزَّن الأسرار مشفّرة. اترك حقل السر فارغًا للإبقاء على المحفوظ.</p>
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الإعدادات</Button>
      </div>
    </div>
  );
}
