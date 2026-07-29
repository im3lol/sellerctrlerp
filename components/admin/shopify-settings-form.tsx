"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Copy, CheckCircle2 } from "lucide-react";
import { saveShopifySettingsAction } from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Initial = { clientId: string; apiVersion: string; hasClientSecret: boolean };

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

export function ShopifySettingsForm({ initial, appUrl }: { initial: Initial; appUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [clientId, setClientId] = useState(initial.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const [apiVersion, setApiVersion] = useState(initial.apiVersion);

  const save = () => start(async () => {
    try {
      const r = await saveShopifySettingsAction({ clientId, clientSecret, apiVersion });
      if ("ok" in r) { toast.success("تم حفظ إعدادات شوبيفاي"); setClientSecret(""); router.refresh(); }
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
          شوبيفاي (Shopify)
          {initial.hasClientSecret && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-600"><CheckCircle2 className="size-3.5" />مُعدّة</span>}
        </CardTitle>
        <CardDescription>مفاتيح تطبيق Shopify Partner (تطبيق عام) لربط متاجر العملاء. يُخزَّن السر مشفّرًا. اترك حقل السر فارغًا للإبقاء على المحفوظ.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="cid">Client ID (API key)</Label>
          <Input id="cid" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="—" dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="csec">Client Secret (API secret key)</Label>
          <Input id="csec" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={initial.hasClientSecret ? "••••••••  (محفوظ — اترك فارغًا للإبقاء عليه)" : "shpss_…"} dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ver">إصدار الـ API <span className="text-muted-foreground">(اختياري)</span></Label>
          <Input id="ver" value={apiVersion} onChange={(e) => setApiVersion(e.target.value)} placeholder="2025-10" dir="ltr" />
          <p className="text-xs text-muted-foreground">اتركه فارغًا للإصدار الافتراضي.</p>
        </div>

        <div className="rounded-xl border bg-muted/20 p-3 space-y-3">
          <div className="text-sm font-medium">في إعدادات تطبيق Shopify Partner، أضِف رابط التحويل (Allowed redirection URL) والـ scopes:</div>
          <CopyRow label="Redirect URL" value={`${base}/api/erp/marketplace/shopify/callback`} />
          <CopyRow label="Scopes" value="read_products,read_orders,read_inventory,read_shopify_payments_payouts" />
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
