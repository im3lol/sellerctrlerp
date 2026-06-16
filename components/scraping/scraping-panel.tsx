"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Play, RefreshCw, Bot } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Workspace = { id: string; name: string };
type Recipe = { id: string; name: string; originHost: string | null; fields: Record<string, unknown> };
type Job = {
  id: string;
  status: string;
  total: number;
  done: number;
  updatedCount: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
};

const STATUS_AR: Record<string, string> = {
  pending: "بانتظار العامل",
  running: "قيد التشغيل",
  done: "اكتمل",
  error: "خطأ",
};

export function ScrapingPanel({ workspaces }: { workspaces: Workspace[] }) {
  const [wsId, setWsId] = useState(workspaces[0]?.id ?? "");
  const [draftCount, setDraftCount] = useState<number | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeId, setRecipeId] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<"incomplete" | "all">("incomplete");

  const load = useCallback(async () => {
    if (!wsId) return;
    setLoading(true);
    try {
      const [d, r, j] = await Promise.all([
        fetch(`/api/scrape/draft-products?workspaceId=${wsId}`).then((x) => x.json()),
        fetch(`/api/scrape/recipes?workspaceId=${wsId}`).then((x) => x.json()),
        fetch(`/api/scrape/jobs?workspaceId=${wsId}`).then((x) => x.json()),
      ]);
      setDraftCount(d.products?.length ?? 0);
      setRecipes(r.recipes ?? []);
      setRecipeId((prev) => prev || r.recipes?.[0]?.id || "");
      setJobs(j.jobs ?? []);
    } catch {
      toast.error("تعذّر تحميل البيانات");
    } finally {
      setLoading(false);
    }
  }, [wsId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while any job is active.
  useEffect(() => {
    const active = jobs.some((j) => j.status === "pending" || j.status === "running");
    if (!active) return;
    const t = setInterval(() => {
      fetch(`/api/scrape/jobs?workspaceId=${wsId}`)
        .then((x) => x.json())
        .then((j) => setJobs(j.jobs ?? []))
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [jobs, wsId]);

  const runJob = async () => {
    if (!recipeId) {
      toast.error("اختر وصفة محفوظة من الإضافة أولاً");
      return;
    }
    setRunning(true);
    try {
      const res = await fetch("/api/scrape/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: wsId,
          recipeId,
          target: mode,
          overwrite: mode === "all",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success(`بدأ السحب على ${data.total} منتج — سيلتقطه العامل قريباً`);
        load();
      } else {
        toast.error(data.error ?? "تعذّر إنشاء المهمة");
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">مساحة العمل</label>
            <select
              value={wsId}
              onChange={(e) => {
                setWsId(e.target.value);
                setRecipeId("");
              }}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm text-muted-foreground">الوصفة (محفوظة من الإضافة)</label>
            <select
              value={recipeId}
              onChange={(e) => setRecipeId(e.target.value)}
              className="w-full rounded-xl border bg-background px-3 py-2 text-sm"
              disabled={recipes.length === 0}
            >
              {recipes.length === 0 ? (
                <option value="">لا توجد وصفات بعد</option>
              ) : (
                recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.originHost ? `· ${r.originHost}` : ""} ({Object.keys(r.fields).length} حقل)
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 p-3">
          <div className="text-sm">
            <span className="text-muted-foreground">منتجات مسودة بلينك جاهزة للسحب: </span>
            <span className="font-semibold">
              {draftCount === null ? "…" : draftCount}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "incomplete" | "all")}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
              title="نوع السحب"
            >
              <option value="incomplete">الناقص فقط (يستأنف)</option>
              <option value="all">إعادة سحب الكل (يستبدل)</option>
            </select>
            <Button variant="outline" onClick={load} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              تحديث
            </Button>
            <Button onClick={runJob} disabled={running || !recipeId}>
              {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              تشغيل السحب
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold">المهام الأخيرة</h2>
        {jobs.length === 0 ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Bot className="size-4" />
            لا توجد مهام بعد. ابنِ وصفة من الإضافة ثم شغّل السحب.
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((j) => {
              const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
              return (
                <div key={j.id} className="rounded-xl border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-sm">
                    <span className="font-medium">{STATUS_AR[j.status] ?? j.status}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {j.done} / {j.total} · حُدّث {j.updatedCount}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full transition-all ${j.status === "error" ? "bg-red-500" : "bg-primary"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {j.lastError && j.status === "error" && (
                    <p className="mt-2 text-xs text-red-600" dir="ltr">{j.lastError}</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
