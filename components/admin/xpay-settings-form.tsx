"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { saveXpaySettingsAction } from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Initial = { baseUrl: string; hasSecretKey: boolean; hasWebhookSecret: boolean };

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

export function XpaySettingsForm({ initial, appUrl }: { initial: Initial; appUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [secretKey, setSecretKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl);

  const save = () => start(async () => {
    try {
      const r = await saveXpaySettingsAction({ secretKey, webhookSecret, baseUrl });
      if ("ok" in r) { toast.success("تم حفظ إعدادات xpay"); setSecretKey(""); setWebhookSecret(""); router.refresh(); }
      else toast.error(r.error);
    } catch (e) {
      toast.error("تعذّر الحفظ: " + (e instanceof Error ? e.message : "خطأ غير متوقع"));
    }
  });

  const base = (appUrl || "").replace(/\/$/, "");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          بوابة الدفع xpay
          {initial.hasSecretKey && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3.5" />مُعدّة</span>}
        </CardTitle>
        <CardDescription>مفاتيح حساب xpay لتحصيل اشتراكات المؤسسات أونلاين. تُخزَّن الأسرار مشفّرة. اترك حقل السر فارغًا للإبقاء على المحفوظ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="sk">المفتاح السري (Secret key)</Label>
          <Input id="sk" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} placeholder={initial.hasSecretKey ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : "sk_test_…  أو  sk_live_…"} dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wh">سر الويبهوك (Webhook secret)</Label>
          <Input id="wh" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder={initial.hasWebhookSecret ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : "whsec_…"} dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="bu">عنوان الـ API <span className="text-muted-foreground">(اختياري)</span></Label>
          <Input id="bu" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.xpay.app" dir="ltr" />
          <p className="text-xs text-muted-foreground">اتركه فارغًا للافتراضي <span dir="ltr" className="font-mono">https://api.xpay.app</span>.</p>
        </div>

        <div className="rounded-xl border bg-muted/20 p-3">
          <div className="mb-2 text-sm font-medium">في لوحة xpay ← Developers ← Webhooks، أضِف هذا العنوان (الحدث <span dir="ltr" className="font-mono">checkout.session.completed</span>):</div>
          <CopyRow label="Webhook URL" value={`${base}/api/subscription/xpay/webhook`} />
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
