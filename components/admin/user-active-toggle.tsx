"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setUserActiveAction } from "@/app/actions/users";
import { Switch } from "@/components/ui/switch";

export function UserActiveToggle({ userId, active }: { userId: string; active: boolean }) {
  const [pending, start] = useTransition();
  return (
    <Switch
      checked={active}
      disabled={pending}
      onCheckedChange={(v) =>
        start(async () => {
          try {
            await setUserActiveAction(userId, v);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "تعذّر التحديث");
          }
        })
      }
    />
  );
}
