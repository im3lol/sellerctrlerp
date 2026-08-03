"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { saveNoonSettingsAction } from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Initial = { clientId: string; hasClientSecret: boolean; hasWebhookSecret: boolean; enabled: boolean };

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

export function NoonSettingsForm({ initial, appUrl }: { initial: Initial; appUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const save = () => start(async () => {
    const r = await saveNoonSettingsAction({ clientId, clientSecret, webhookSecret, enabled });
    if ("ok" in r) { toast.success("تم حفظ إعدادات نون"); setClientSecret(""); setWebhookSecret(""); router.refresh(); }
    else toast.error(r.error);
  });

  const base = (appUrl || "").replace(/\/$/, "");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            نون (Noon)
            {initial.hasClientSecret && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3.5" />مُعدّة</span>}
          </CardTitle>
          <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />{enabled ? "مُفعّلة" : "موقوفة"}</label>
        </div>
        <CardDescription>مفاتيح تكامل OAuth من نون (تطبيق واحد يخدم كل البائعين) — بيها يربط البائع حسابه بضغطة. يُخزَّن السر مشفّرًا. اترك حقول الأسرار فارغة للإبقاء على المحفوظ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="ncid">Client ID</Label>
          <Input id="ncid" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="—" dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ncsec">Client Secret</Label>
          <Input id="ncsec" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={initial.hasClientSecret ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : "—"} dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="nwsec">Webhook Secret <span className="text-muted-foreground">(اختياري)</span></Label>
          <Input id="nwsec" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={initial.hasWebhookSecret ? "•••••••• (محفوظ)" : "سر اختياري لتأمين استقبال الطلبات"} dir="ltr" autoComplete="off" />
          <p className="text-xs text-muted-foreground">لو ضبطته، أضِفه للـWebhook URL كـ<span dir="ltr" className="font-mono">?key=…</span></p>
        </div>

        <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">سجّل التالي في بوابة نون (access.noon.partners):</div>
          <CopyRow label="Redirect URI" value={`${base}/api/erp/marketplace/noon/callback`} />
          <CopyRow label="Scopes" value="access:grant" />
          <CopyRow label="Webhook URL (لإشعارات الطلبات)" value={`${base}/api/erp/marketplace/noon/webhook`} />
        </div>

        <div className="flex justify-end">
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}حفظ الإعدادات
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
