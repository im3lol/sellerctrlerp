"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { saveAmazonSettingsAction } from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Initial = { lwaClientId: string; appId: string; hasClientSecret: boolean; enabled: boolean };

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

export function AmazonSettingsForm({ initial, appUrl }: { initial: Initial; appUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [lwaClientId, setLwaClientId] = useState(initial.lwaClientId);
  const [lwaClientSecret, setLwaClientSecret] = useState("");
  const [appId, setAppId] = useState(initial.appId);

  const save = () => start(async () => {
    const r = await saveAmazonSettingsAction({ lwaClientId, lwaClientSecret, appId, enabled });
    if ("ok" in r) { toast.success("تم حفظ إعدادات أمازون"); setLwaClientSecret(""); router.refresh(); }
    else toast.error(r.error);
  });

  const base = (appUrl || "").replace(/\/$/, "");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            أمازون (Amazon SP-API)
            {initial.hasClientSecret && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3.5" />مُعدّة</span>}
          </CardTitle>
          <label className="flex items-center gap-2 text-sm"><Switch checked={enabled} onCheckedChange={setEnabled} />{enabled ? "مُفعّلة" : "موقوفة"}</label>
        </div>
        <CardDescription>مفاتيح تطبيق SP-API (تطبيق واحد يخدم كل العملاء) لربط حسابات البائعين. يُخزَّن السر مشفّرًا. اترك حقل السر فارغًا للإبقاء على المحفوظ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="acid">LWA Client ID</Label>
          <Input id="acid" value={lwaClientId} onChange={(e) => setLwaClientId(e.target.value)} placeholder="amzn1.application-oa2-client.…" dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="acsec">LWA Client Secret</Label>
          <Input id="acsec" value={lwaClientSecret} onChange={(e) => setLwaClientSecret(e.target.value)} placeholder={initial.hasClientSecret ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : "amzn1.oa2-cs.…"} dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="aappid">Application ID <span className="text-muted-foreground">(للموافقة)</span></Label>
          <Input id="aappid" value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="amzn1.sp.solution.…" dir="ltr" autoComplete="off" />
        </div>

        <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">في إعدادات تطبيق SP-API، أضِف رابط التحويل (OAuth Redirect URI):</div>
          <CopyRow label="Redirect URI" value={`${base}/api/erp/marketplace/amazon/callback`} />
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
