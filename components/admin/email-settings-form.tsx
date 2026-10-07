"use client";

import { useState, useTransition } from "react";
import { fill } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { Loader2 } from "lucide-react";
import { saveEmailSettingsAction, testEmailSettingsAction } from "@/app/actions/admin/platform-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Initial = { host: string; port: number; user: string; from: string; fromName: string; hasPass: boolean };

export function EmailSettingsForm({ initial }: { initial: Initial }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port || 587));
  const [user, setUser] = useState(initial.user);
  const [pass, setPass] = useState("");
  const [from, setFrom] = useState(initial.from);
  const [fromName, setFromName] = useState(initial.fromName);

  const save = () => start(async () => {
    try {
      const r = await saveEmailSettingsAction({ host, port: Number(port), user, pass, from, fromName });
      if ("ok" in r) { toast.success("تم حفظ إعدادات البريد"); setPass(""); router.refresh(); }
      else toast.error(r.error);
    } catch (e) {
      toast.error(fill(t("تعذّر الحفظ: {0}"), [e instanceof Error ? e.message : t("خطأ غير متوقع")]));
    }
  });

  const test = () => start(async () => {
    try {
      const r = await testEmailSettingsAction();
      if ("ok" in r) toast.success("تم إرسال رسالة اختبار إلى بريد حسابك");
      else toast.error(r.error);
    } catch {
      toast.error("تعذّر إرسال رسالة الاختبار");
    }
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">{t("خادم SMTP لإرسال رسائل الترحيب وإيصالات الدفع وتذكيرات انتهاء الاشتراك. تُخزَّن كلمة المرور مشفّرة. اترك حقل كلمة المرور فارغًا للإبقاء على المحفوظة.")}</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2 space-y-2">
            <Label htmlFor="host">{t("خادم SMTP")}</Label>
            <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="smtp.example.com" dir="ltr" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="port">{t("المنفذ")}</Label>
            <Input id="port" value={port} onChange={(e) => setPort(e.target.value)} placeholder="587" dir="ltr" inputMode="numeric" />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user">{t("اسم المستخدم")}</Label>
          <Input id="user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="info@sellerctrl.com" dir="ltr" autoComplete="off" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pass">{t("كلمة المرور")}</Label>
          <Input id="pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder={initial.hasPass ? t("••••••••  (محفوظة — اتركها فارغة للإبقاء عليها)") : t("كلمة مرور SMTP")} dir="ltr" autoComplete="new-password" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="from">{t("عنوان المُرسِل")}</Label>
            <Input id="from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="info@sellerctrl.com" dir="ltr" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fromName">{t("اسم المُرسِل")}</Label>
            <Input id="fromName" value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="SellerCtrl" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("المنفذ ٤٦٥ = SSL، و٥٨٧ = STARTTLS. مع Gmail استخدم «كلمة مرور تطبيق».")}</p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={test} disabled={pending || !initial.hasPass}>
            {t("اختبار الإرسال")}
          </Button>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}{t("حفظ الإعدادات")}
          </Button>
        </div>
    </div>
  );
}
