"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { saveAiSettingsAction } from "@/app/actions/admin/platform-settings";
import { AI_MODELS } from "@/lib/erp/ai-bill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectCls } from "@/lib/utils";

type Initial = { model: string; monthlyLimit: number; hasKey: boolean; usedThisMonth: number };

export function AiSettingsForm({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(initial.model);
  const [limit, setLimit] = useState(String(initial.monthlyLimit));

  const save = () => start(async () => {
    const r = await saveAiSettingsAction({ apiKey, model: model || null, monthlyLimit: Number(limit) });
    if ("ok" in r) { toast.success("تم حفظ إعدادات الذكاء الاصطناعي"); setApiKey(""); router.refresh(); }
    else toast.error(r.error);
  });

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        مفتاح Anthropic API اللي بتقرا بيه الشركات فواتيرها. الميزة بتفضل مقفولة لحد ما تختار موديل.
        المفتاح بيتخزن مشفّر، ومش بيرجع للمتصفح. الشركة اللي تضيف مفتاحها الخاص بتستخدمه هو ومش بتتحسب من الحد.
      </p>
      <div className="space-y-2">
        <Label htmlFor="ai-key">مفتاح API</Label>
        <Input id="ai-key" type="password" dir="ltr" autoComplete="new-password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
          placeholder={initial.hasKey ? "••••••••  (محفوظ — سيبه فاضي عشان يفضل)" : "sk-ant-…"} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label htmlFor="ai-model">الموديل</Label>
          <select id="ai-model" className={selectCls} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">لسه ماتحددش — الميزة مقفولة</option>
            {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ai-limit">حد كل شركة في الشهر</Label>
          <Input id="ai-limit" type="number" min={0} inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">اتقرا الشهر ده على مفتاح المنصة: {initial.usedThisMonth.toLocaleString("ar-EG-u-nu-latn")} فاتورة.</p>
      <div className="flex justify-end">
        <Button onClick={save} disabled={pending}>{pending && <Loader2 className="size-4 animate-spin" />}حفظ الإعدادات</Button>
      </div>
    </div>
  );
}
