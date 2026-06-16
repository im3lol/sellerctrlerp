"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateProfileAction, type ActionState } from "@/app/actions/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      حفظ التغييرات
    </Button>
  );
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(updateProfileAction, {});

  useEffect(() => {
    if (state.ok) toast.success("تم حفظ الملف الشخصي");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="p-name">الاسم</Label>
        <Input id="p-name" name="name" defaultValue={name} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-email">البريد الإلكتروني</Label>
        <Input id="p-email" value={email} dir="ltr" disabled />
        <p className="text-xs text-muted-foreground">لا يمكن تغيير البريد الإلكتروني.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="p-pass">كلمة مرور جديدة</Label>
        <Input id="p-pass" name="password" type="password" dir="ltr" placeholder="اتركها فارغة للإبقاء على الحالية" />
      </div>
      <Submit />
    </form>
  );
}
