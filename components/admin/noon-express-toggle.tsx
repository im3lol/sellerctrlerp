"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setNoonExpressAction } from "@/app/actions/admin/tenants";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/icon";

/** Owner-only opt-in for Noon Express (FBPI) order auto-ingest — not a tenant self-service
 *  setting, so it lives here on the admin tenant page rather than the org's own settings. */
export function NoonExpressToggle({ orgId, noon }: { orgId: string; noon: { connected: boolean; expressEnabled: boolean } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(noon.expressEnabled);

  const toggle = (v: boolean) => start(async () => {
    const r = await setNoonExpressAction({ orgId, enabled: v });
    if ("ok" in r && r.ok) { setEnabled(v); toast.success(v ? "تم تفعيل Noon Express لهذه المؤسسة" : "تم إيقاف Noon Express"); router.refresh(); }
    else toast.error(("error" in r && r.error) || "تعذّر الحفظ");
  });

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-3 pt-6">
        <div className="flex items-center gap-2">
          <Icon name="Rocket" className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-medium">Noon Express (FBPI)</div>
            <div className="text-xs text-muted-foreground">
              {noon.connected ? "استقبال طلبات FBPI تلقائيًا عبر Webhook نون." : "المؤسسة لسه مربوطاش حساب نون — اربطها أولًا."}
            </div>
          </div>
        </div>
        <Switch checked={enabled} disabled={pending || !noon.connected} onCheckedChange={toggle} />
      </CardContent>
    </Card>
  );
}
