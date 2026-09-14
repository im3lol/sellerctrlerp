"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveOrgAiKeyAction, removeOrgAiKeyAction } from "@/app/actions/erp/ai-settings";
import { AI_MODELS, DEFAULT_AI_MODEL } from "@/lib/erp/ai-bill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { selectCls } from "@/lib/utils";

export function OrgAiKeyForm({ hasKey, model: initialModel }: { hasKey: boolean; model: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initialModel || DEFAULT_AI_MODEL);

  const save = () => start(async () => {
    const r = await saveOrgAiKeyAction({ apiKey, model });
    if (!r.ok) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
    toast.success("اتحفظ"); setApiKey(""); router.refresh();
  });

  const remove = () => void (async () => {
    const go = await confirm({
      danger: true, title: "تشيل مفتاح شركتك؟",
      description: "القراءات هترجع على مفتاح المنصة وحدها الشهري — لو المنصة مفعّلاها.",
      confirmText: "شيله", cancelText: "رجوع",
    });
    if (!go) return;
    start(async () => {
      const r = await removeOrgAiKeyAction();
      if (!r.ok) { toast.error(r.error ?? "تعذّر الحذف"); return; }
      toast.success("اتشال"); router.refresh();
    });
  })();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="org-ai-key">مفتاح Anthropic API</Label>
        <Input id="org-ai-key" type="password" dir="ltr" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasKey ? "••••••••  (محفوظ — سيبه فاضي عشان يفضل)" : "sk-ant-…"} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="org-ai-model">الموديل</Label>
        <select id="org-ai-model" className={`${selectCls} w-72`} value={model} onChange={(e) => setModel(e.target.value)}>
          {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={save} disabled={pending || (!hasKey && !apiKey.trim())}><Icon name="Check" className="size-4" />حفظ</Button>
        {hasKey && <Button variant="ghost" className="text-destructive" disabled={pending} onClick={remove}><Icon name="Trash2" className="size-4" />شيل المفتاح</Button>}
      </div>
    </div>
  );
}
