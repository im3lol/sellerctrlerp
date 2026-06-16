"use client";

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

export function LoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, formAction] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">تسجيل الدخول</h1>
        <p className="text-sm text-muted-foreground">
          أدخل بياناتك للوصول إلى مساحة العمل
        </p>
      </div>

      {state.error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <input type="hidden" name="callbackUrl" value={callbackUrl ?? "/dashboard"} />

      <div className="space-y-2">
        <Label htmlFor="email">البريد الإلكتروني</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="name@sellerctrl.com"
          dir="ltr"
          required
          autoComplete="email"
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

      <p className="text-center text-xs text-muted-foreground">
        حساب تجريبي: admin@sellerctrl.com / password123
      </p>
    </form>
  );
}
