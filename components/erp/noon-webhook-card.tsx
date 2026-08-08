"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, Loader2, RefreshCw, Webhook, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { regenerateNoonWebhookAction, type NoonWebhookInfo } from "@/app/actions/erp/noon-webhook";

// Noon webhook self-service: the secret is generated + registered automatically on connect.
// This card shows the URL + secret (for the manual-portal fallback) and a one-click button
// to rotate the secret and re-register the destination — no invented secret, no portal visit.
export function NoonWebhookCard({ initial }: { initial: NoonWebhookInfo }) {
  const [url] = useState(initial.url);
  const [secret, setSecret] = useState(initial.secret);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState<string | null>(null);

  const copy = (label: string, value: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label); toast.success("تم النسخ");
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    });
  };

  const regen = () => start(async () => {
    const r = await regenerateNoonWebhookAction();
    if (!r.ok) { toast.error(r.error); return; }
    setSecret(r.secret);
    if (r.registered) toast.success("تم توليد سرّ جديد وتسجيل الويب‌هوك على نون تلقائيًا");
    else toast.warning(r.note ?? "تم توليد سرّ جديد — سجّله يدويًا على بوابة نون");
  });

  const field = (label: string, value: string, key: string, mono = true) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} dir="ltr" className={mono ? "font-mono text-xs" : ""} onFocus={(e) => e.currentTarget.select()} />
        <Button type="button" variant="outline" size="icon" onClick={() => copy(key, value)} title="نسخ">
          {copied === key ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Webhook className="size-4" />ويب‌هوك نون (طلبات + مرتجعات)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          السرّ بيتولّد ويتسجّل تلقائيًا وقت الربط — مش محتاج تعمله بنفسك. لو حبيت تغيّره، اضغط «تجديد» وهيتسجّل الجديد على نون تلقائيًا. القيم تحت للتسجيل اليدوي على بوابة نون لو احتجت.
        </p>
        {field("Destination URL", url, "url")}
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          {field("Credentials · Key", "key", "cred-key")}
          {field("Credentials · Value (السرّ)", secret || "— لسه ماتولّدش —", "secret")}
        </div>
        <Button type="button" onClick={regen} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {secret ? "تجديد السرّ + إعادة التسجيل" : "توليد السرّ + تسجيل تلقائي"}
        </Button>
      </CardContent>
    </Card>
  );
}
