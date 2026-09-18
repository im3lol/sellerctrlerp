"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  configureTelegramWebhookAction,
  saveTelegramSettingsAction,
  testTelegramSettingsAction,
} from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Initial = { hasBotToken: boolean; hasAlertChatId: boolean; botUsername: string | null; importedFromEnv: boolean };

export function TelegramSettingsForm({ initial, appUrl }: { initial: Initial; appUrl: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [botToken, setBotToken] = useState("");
  const [alertChatId, setAlertChatId] = useState("");
  const configured = initial.hasBotToken && initial.hasAlertChatId;
  const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;

  const save = () => start(async () => {
    try {
      const r = await saveTelegramSettingsAction({ botToken, alertChatId });
      if ("ok" in r) {
        toast.success("تم حفظ إعدادات تليجرام بشكل مشفّر");
        setBotToken(""); setAlertChatId(""); router.refresh();
      } else toast.error(r.error);
    } catch { toast.error("تعذّر حفظ إعدادات تليجرام"); }
  });

  const test = () => start(async () => {
    try {
      const r = await testTelegramSettingsAction();
      if ("ok" in r) toast.success("تم إرسال رسالة اختبار إلى محادثة التنبيهات");
      else toast.error(r.error);
    } catch { toast.error("تعذّر اختبار تليجرام"); }
  });

  const webhook = () => start(async () => {
    try {
      const r = await configureTelegramWebhookAction();
      if ("ok" in r) toast.success("تم تهيئة Webhook تليجرام بأمان");
      else toast.error(r.error);
    } catch { toast.error("تعذّرت تهيئة Webhook"); }
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        يُستخدم البوت لتنبيهات التشغيل ولموافقات الفريق. تُخزّن القيم مشفّرة ولا تُعرض مجددًا. اترك أي حقل فارغًا للحفاظ على القيمة المحفوظة.
      </p>
      {initial.importedFromEnv && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">تم ترحيل إعدادات تليجرام الموجودة على السيرفر تلقائيًا إلى لوحة الإدارة.</p>}
      <div className="space-y-2">
        <Label htmlFor="telegram-token">رمز البوت (Bot token)</Label>
        <Input id="telegram-token" type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)} dir="ltr" autoComplete="new-password"
          placeholder={initial.hasBotToken ? "••••••••  (محفوظ ومشفّر)" : "123456:ABC…"} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="telegram-chat">معرّف محادثة التنبيهات (Chat ID)</Label>
        <Input id="telegram-chat" value={alertChatId} onChange={(e) => setAlertChatId(e.target.value)} dir="ltr" inputMode="numeric" autoComplete="off"
          placeholder={initial.hasAlertChatId ? "••••••••  (محفوظ ومشفّر)" : "123456789"} />
      </div>
      <div className="rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground">
        <p>Webhook الموافقات: <span className="font-mono" dir="ltr">{webhookUrl}</span></p>
        {initial.botUsername && <p className="mt-1">البوت المتصل: <span dir="ltr" className="font-medium">@{initial.botUsername}</span></p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={test} disabled={pending || !configured}>اختبار الإرسال</Button>
        <Button variant="outline" onClick={webhook} disabled={pending || !initial.hasBotToken}>تهيئة Webhook</Button>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}حفظ الإعدادات
        </Button>
      </div>
    </div>
  );
}
