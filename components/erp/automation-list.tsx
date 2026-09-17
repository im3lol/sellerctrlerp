"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { addTemplateAction, deleteRuleAction, toggleRuleAction } from "@/app/actions/erp/automation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

export function RuleToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Switch checked={enabled} disabled={pending} aria-label={enabled ? "إيقاف القاعدة" : "تشغيل القاعدة"}
      onCheckedChange={(v) => start(async () => {
        const r = await toggleRuleAction(id, v);
        if (!r.ok) toast.error(r.error ?? "تعذّر التغيير");
        router.refresh();
      })} />
  );
}

export function RuleDelete({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" aria-label="مسح" disabled={pending} onClick={() => void (async () => {
      const go = await confirm({ danger: true, title: `تمسح القاعدة «${name}»؟`, description: "هتقف فوراً، وسجل تشغيلها هيتمسح معاها.", confirmText: "امسح", cancelText: "رجوع" });
      if (!go) return;
      start(async () => {
        const r = await deleteRuleAction(id);
        if (r.ok) { toast.success("اتمسحت"); router.refresh(); } else toast.error(r.error ?? "تعذّر المسح");
      });
    })()}>
      <Icon name="Trash2" className="size-4 text-destructive" />
    </Button>
  );
}

export function AddTemplateButton({ templateKey, needsSetup }: { templateKey: string; needsSetup: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await addTemplateAction(templateKey);
      if (!r.ok || !r.id) { toast.error(r.error ?? "تعذّر الإضافة"); return; }
      if (needsSetup) {
        toast.success("اتضافت متوقفة — حط الرابط بتاعك وشغّلها");
        router.push(`/automation/${r.id}`);
      } else {
        toast.success("اتضافت وبقت شغّالة");
        router.refresh();
      }
    })}>
      <Icon name="Plus" className="size-4" />{needsSetup ? "ضيف وظبّط" : "فعّلها"}
    </Button>
  );
}
