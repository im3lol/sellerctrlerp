"use client";

import { useTransition } from "react";
import { useT } from "@/lib/i18n/client";
import { useRouter } from "next/navigation";
import { toast } from "@/lib/i18n/toast";
import { addTemplateAction, deleteRuleAction, toggleRuleAction } from "@/app/actions/erp/automation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";

export function RuleToggle({ id, enabled }: { id: string; enabled: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Switch checked={enabled} disabled={pending} aria-label={enabled ? t("إيقاف القاعدة") : t("تشغيل القاعدة")}
      onCheckedChange={(v) => start(async () => {
        const r = await toggleRuleAction(id, v);
        if (!r.ok) toast.error(r.error ?? t("تعذّر التغيير"));
        router.refresh();
      })} />
  );
}

export function RuleDelete({ id, name }: { id: string; name: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="icon" variant="ghost" aria-label={t("مسح")} disabled={pending} onClick={() => void (async () => {
      const go = await confirm({ danger: true, title: `تمسح القاعدة «${name}»؟`, description: "هتقف فوراً، وسجل تشغيلها هيتمسح معاها.", confirmText: "امسح", cancelText: "رجوع" });
      if (!go) return;
      start(async () => {
        const r = await deleteRuleAction(id);
        if (r.ok) { toast.success("اتمسحت"); router.refresh(); } else toast.error(r.error ?? t("تعذّر المسح"));
      });
    })()}>
      <Icon name="Trash2" className="size-4 text-destructive" />
    </Button>
  );
}

export function AddTemplateButton({ templateKey, needsSetup }: { templateKey: string; needsSetup: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
      const r = await addTemplateAction(templateKey);
      if (!r.ok || !r.number) { toast.error(r.error ?? t("تعذّر الإضافة")); return; }
      if (needsSetup) {
        toast.success("اتضافت متوقفة — حط الرابط بتاعك وشغّلها");
        router.push(`/automation/${encodeURIComponent(r.number)}`);
      } else {
        toast.success("اتضافت وبقت شغّالة");
        router.refresh();
      }
    })}>
      <Icon name="Plus" className="size-4" />{needsSetup ? t("ضيف وظبّط") : t("فعّلها")}
    </Button>
  );
}
