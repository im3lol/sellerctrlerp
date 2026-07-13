"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changePasswordAction, beginMfaSetupAction, enableMfaAction, disableMfaAction } from "@/app/actions/account";
import { validatePassword, PASSWORD_RULE_AR } from "@/lib/auth/password-policy";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/icon";

export function AccountSecurity({ mfaEnabled, passwordChangedAt }: { mfaEnabled: boolean; passwordChangedAt: string | null }) {
  const [pending, start] = useTransition();

  // ── Change password ──
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [confirm, setConfirm] = useState("");
  const changePassword = () => {
    if (nw !== confirm) { toast.error("كلمتا المرور غير متطابقتين"); return; }
    const e = validatePassword(nw);
    if (e) { toast.error(e); return; }
    start(async () => {
      const r = await changePasswordAction(cur, nw);
      if (r.ok) { toast.success("تم تغيير كلمة المرور"); setCur(""); setNw(""); setConfirm(""); }
      else toast.error(r.error ?? "تعذّر التغيير");
    });
  };

  // ── MFA ──
  const [enabled, setEnabled] = useState(mfaEnabled);
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [backup, setBackup] = useState<string[] | null>(null);
  const [disablePw, setDisablePw] = useState("");

  const beginSetup = () => start(async () => {
    const r = await beginMfaSetupAction();
    if ("error" in r) { toast.error(r.error); return; }
    setSetup({ qrDataUrl: r.qrDataUrl, secret: r.secret });
  });
  const confirmEnable = () => start(async () => {
    const r = await enableMfaAction(code);
    if (r.ok) { setEnabled(true); setSetup(null); setCode(""); setBackup(r.backupCodes ?? []); toast.success("تم تفعيل المصادقة الثنائية"); }
    else toast.error(r.error ?? "تعذّر التفعيل");
  });
  const disable = () => start(async () => {
    const r = await disableMfaAction(disablePw);
    if (r.ok) { setEnabled(false); setDisablePw(""); toast.success("تم إيقاف المصادقة الثنائية"); }
    else toast.error(r.error ?? "تعذّر الإيقاف");
  });

  const daysSinceChange = passwordChangedAt ? Math.floor((Date.now() - new Date(passwordChangedAt).getTime()) / 86400000) : null;
  const expiringSoon = daysSinceChange != null && daysSinceChange > 335;

  return (
    <div className="space-y-6">
      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle>تغيير كلمة المرور</CardTitle>
          <CardDescription>{PASSWORD_RULE_AR}. {daysSinceChange != null && <span className={expiringSoon ? "text-amber-600" : ""}>آخر تغيير قبل {daysSinceChange} يوم{expiringSoon ? " — يُنصح بالتغيير (تنتهي كل 365 يوم)" : ""}.</span>}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5"><Label>كلمة المرور الحالية</Label><Input type="password" dir="ltr" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
          <div className="space-y-1.5"><Label>كلمة المرور الجديدة</Label><Input type="password" dir="ltr" value={nw} onChange={(e) => setNw(e.target.value)} placeholder={PASSWORD_RULE_AR} /></div>
          <div className="space-y-1.5"><Label>تأكيد كلمة المرور الجديدة</Label><Input type="password" dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
          <Button onClick={changePassword} disabled={pending || !cur || !nw}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}تغيير كلمة المرور</Button>
        </CardContent>
      </Card>

      {/* MFA */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">المصادقة الثنائية (2FA) {enabled ? <Badge className="bg-emerald-600">مفعّلة</Badge> : <Badge variant="secondary">غير مفعّلة</Badge>}</CardTitle>
          <CardDescription>طبقة حماية إضافية عبر رمز مؤقّت من تطبيق مصادقة (Google Authenticator / Authy).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {backup && (
            <div className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <div className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-400">رموز احتياطية — احفظها في مكان آمن (تظهر مرة واحدة)</div>
              <div className="grid grid-cols-2 gap-1 font-mono text-sm" dir="ltr">{backup.map((c) => <span key={c}>{c}</span>)}</div>
            </div>
          )}

          {!enabled && !setup && (
            <Button onClick={beginSetup} disabled={pending}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}تفعيل المصادقة الثنائية</Button>
          )}

          {!enabled && setup && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">امسح رمز QR بتطبيق المصادقة، ثم أدخل الرمز المكوّن من 6 أرقام للتأكيد.</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="QR" className="size-44 rounded-lg border bg-white p-1" />
              <p className="text-xs text-muted-foreground">أو أدخل السر يدويًا: <span className="font-mono" dir="ltr">{setup.secret}</span></p>
              <div className="flex items-end gap-2">
                <div className="space-y-1.5"><Label>رمز التأكيد</Label><Input dir="ltr" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" className="w-40" /></div>
                <Button onClick={confirmEnable} disabled={pending || code.length < 6}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}تأكيد وتفعيل</Button>
                <Button variant="ghost" onClick={() => setSetup(null)}>إلغاء</Button>
              </div>
            </div>
          )}

          {enabled && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5"><Label>لإيقافها، أدخل كلمة مرورك</Label><Input type="password" dir="ltr" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} className="w-56" /></div>
              <Button variant="destructive" onClick={disable} disabled={pending || !disablePw}>{pending && <Icon name="Loader2" className="size-4 animate-spin" />}إيقاف المصادقة الثنائية</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
