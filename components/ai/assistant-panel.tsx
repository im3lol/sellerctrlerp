"use client";

import { useState, useTransition } from "react";
import { Sparkles, Loader2, AlertTriangle, UserX, Lightbulb } from "lucide-react";
import { toast } from "sonner";
import { runOpsAnalysisAction } from "@/app/actions/ai";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { OpsAnalysis } from "@/lib/ai";

export function AssistantPanel({ configured }: { configured: boolean }) {
  const [result, setResult] = useState<OpsAnalysis | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      try {
        setResult(await runOpsAnalysisAction());
      } catch {
        toast.error("تعذّر تشغيل التحليل");
      }
    });

  return (
    <div className="space-y-6">
      <Card className="flex flex-col items-center gap-4 p-8 text-center">
        <div className="grid size-16 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Sparkles className="size-8" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-bold">مساعد العمليات الذكي</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            يحلّل الأداء ويكتشف الاختناقات والموظفين المتعثرين والمنتجات المتأخرة، ثم يقترح إعادة توزيع العمل.
          </p>
        </div>
        {!configured && (
          <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-xs text-amber-700">
            مفتاح Anthropic غير مضبوط — سيتم استخدام التحليل الآلي المبني على القواعد.
          </p>
        )}
        <Button onClick={run} disabled={pending} size="lg">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
          تشغيل التحليل
        </Button>
      </Card>

      {result && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">الملخص</h3>
              <Badge variant="secondary">{result.source === "ai" ? "تحليل ذكي" : "تحليل آلي"}</Badge>
            </div>
            <p className="text-sm leading-relaxed">{result.summary}</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <AlertTriangle className="size-4 text-warning" />
                الاختناقات
              </h3>
              {result.bottlenecks.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا توجد اختناقات واضحة.</p>
              ) : (
                <ul className="space-y-2">
                  {result.bottlenecks.map((b, i) => (
                    <li key={i} className="rounded-xl bg-muted/40 p-3">
                      <p className="text-sm font-medium">{b.title}</p>
                      <p className="text-xs text-muted-foreground">{b.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <UserX className="size-4 text-destructive" />
                موظفون متعثرون
              </h3>
              {result.strugglingEmployees.length === 0 ? (
                <p className="text-sm text-muted-foreground">لا يوجد موظفون متعثرون.</p>
              ) : (
                <ul className="space-y-2">
                  {result.strugglingEmployees.map((e, i) => (
                    <li key={i} className="rounded-xl bg-muted/40 p-3">
                      <p className="text-sm font-medium">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card className="p-5">
            <h3 className="mb-3 flex items-center gap-2 font-semibold">
              <Lightbulb className="size-4 text-primary" />
              التوصيات
            </h3>
            <ul className="space-y-2">
              {result.recommendations.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" />
                  {r}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
