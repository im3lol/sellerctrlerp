"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { AlertCircle, Loader2 } from "lucide-react";
import { loginAction, type LoginState } from "@/app/(auth)/login/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" size="lg" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      تسجيل الدخول
    </Button>
  );
}

export function LoginForm({
  callbackUrl,
  title = "تسجيل الدخول",
  subtitle = "أدخل بياناتك للوصول إلى مساحة العمل",
  welcome,
  hint,
  signupHref,
}: {
  callbackUrl?: string;
  title?: string;
  subtitle?: string;
  welcome?: string;
  hint?: string;
  signupHref?: string; // when set, shows a "create an account" link instead of the "no self-registration" note
}) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>

      {welcome && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-center text-sm text-primary">
          {welcome}
        </div>
      )}

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/dashboard"} />

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني أو اسم المستخدم</Label>
        <Input
          id="email"
          name="email"
          type="text"
          placeholder="admin أو name@sellerctrl.com"
          dir="ltr"
          required
          autoComplete="username"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">كلمة المرور</Label>
        <Input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          required
          autoComplete="current-password"
        />
      </div>

      <SubmitButton />

      {hint && <p className="text-center text-xs text-muted-foreground">{hint}</p>}
      {signupHref ? (
        <p className="text-center text-sm text-muted-foreground">
          ليس لديك حساب؟{" "}
          <Link href={signupHref} className="font-medium text-primary hover:underline">أنشئ حساب مؤسستك الآن</Link>
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          لا يوجد تسجيل ذاتي — للحصول على حساب تواصل مع الإدارة.
        </p>
      )}
    </form>
  );
}
