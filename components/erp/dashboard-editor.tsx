"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveDashboardAction, deleteDashboardAction } from "@/app/actions/erp/dashboards";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/icon";
import { confirm } from "@/components/erp/confirm";
import { selectCls } from "@/lib/utils";

type Widget = { reportId: string; wide?: boolean };
type ReportOption = { id: string; nameAr: string; datasetTitle: string; isShared: boolean };

/** A new dashboard starts as a name; its reports go in on its own page. */
export function NewDashboardButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState<string | null>(null);

  if (name == null) {
    return <Button onClick={() => setName("")}><Icon name="Plus" className="size-4" />لوحة جديدة</Button>;
  }
  return (
    <form className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveDashboardAction({ nameAr: name, widgets: [] });
          if (!r.ok || !r.id) { toast.error(r.error ?? "تعذّر الإنشاء"); return; }
          router.push(`/reports/dashboards/${r.id}?edit=1`);
        });
      }}>
      <Input className="w-64" autoFocus placeholder="اسم اللوحة" value={name} onChange={(e) => setName(e.target.value)} />
      <Button type="submit" disabled={pending || !name.trim()}><Icon name="Check" className="size-4" />أنشئ</Button>
      <Button type="button" variant="ghost" onClick={() => setName(null)}>رجوع</Button>
    </form>
  );
}

export function DashboardEditor({ dashboard, reports }: {
  dashboard: { id: string; nameAr: string; isShared: boolean; widgets: Widget[] };
  reports: ReportOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [nameAr, setName] = useState(dashboard.nameAr);
  const [isShared, setShared] = useState(dashboard.isShared);
  const [widgets, setWidgets] = useState<Widget[]>(dashboard.widgets);
  const [pick, setPick] = useState("");
  const view = `/reports/dashboards/${dashboard.id}`;

  const report = (id: string) => reports.find((r) => r.id === id);
  // A private report on a shared dashboard shows only to its owner — say so before saving.
  const privateOnShared = isShared && widgets.some((w) => report(w.reportId)?.isShared === false);

  const move = (i: number, by: number) => setWidgets((w) => {
    const j = i + by;
    if (j < 0 || j >= w.length) return w;
    const n = w.slice();
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  const save = () => start(async () => {
    const r = await saveDashboardAction({ id: dashboard.id, nameAr, isShared, widgets });
    if (!r.ok) { toast.error(r.error ?? "تعذّر الحفظ"); return; }
    toast.success("اتحفظت");
    router.push(view);
    router.refresh();
  });

  const remove = () => void (async () => {
    const go = await confirm({
      danger: true, title: `تمسح لوحة «${dashboard.nameAr}»؟`,
      description: "اللوحة بس اللي هتتمسح — التقارير المحفوظة والبيانات مش بتتأثر.",
      confirmText: "امسح", cancelText: "رجوع",
    });
    if (!go) return;
    start(async () => {
      const r = await deleteDashboardAction(dashboard.id);
      if (!r.ok) { toast.error(r.error ?? "تعذّر المسح"); return; }
      toast.success("اتمسحت");
      router.push("/reports/dashboards");
    });
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle>تعديل اللوحة</CardTitle>
        <CardDescription>كل مربّع في اللوحة تقرير محفوظ من باني التقارير — بالرسم اللي اتحفظ بيه.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label>الاسم</Label>
            <Input className="w-64" value={nameAr} onChange={(e) => setName(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="size-4 rounded border-input" checked={isShared}
              onChange={(e) => setShared(e.target.checked)} />
            شاركها مع باقي الفريق
          </label>
        </div>

        {reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            مفيش تقارير محفوظة لسه — ابنِ واحد من <Link href="/reports/builder" className="text-primary underline">باني التقارير</Link> واحفظه.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-2">
              <Label>ضيف تقرير محفوظ</Label>
              <select className={`${selectCls} w-72`} value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">اختار…</option>
                {reports.map((r) => <option key={r.id} value={r.id}>{r.nameAr} ({r.datasetTitle})</option>)}
              </select>
            </div>
            <Button variant="outline" disabled={!pick || widgets.length >= 12}
              onClick={() => { setWidgets((w) => [...w, { reportId: pick }]); setPick(""); }}>
              <Icon name="Plus" className="size-4" />ضيف
            </Button>
          </div>
        )}

        {widgets.length > 0 && (
          <ol className="space-y-2">
            {widgets.map((w, i) => (
              <li key={`${w.reportId}-${i}`} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                <span className="flex-1 truncate">{report(w.reportId)?.nameAr ?? "تقرير مش متاح"}</span>
                <Button size="sm" variant={w.wide ? "default" : "outline"}
                  onClick={() => setWidgets((ws) => ws.map((x, k) => (k === i ? { ...x, wide: !x.wide } : x)))}>
                  {w.wide ? "عرض كامل" : "نص عرض"}
                </Button>
                <Button size="icon" variant="ghost" aria-label="لفوق" disabled={i === 0} onClick={() => move(i, -1)}>
                  <Icon name="ArrowUp" className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="لتحت" disabled={i === widgets.length - 1} onClick={() => move(i, 1)}>
                  <Icon name="ArrowDown" className="size-4" />
                </Button>
                <Button size="icon" variant="ghost" aria-label="شيل" onClick={() => setWidgets((ws) => ws.filter((_, k) => k !== i))}>
                  <Icon name="X" className="size-4 text-destructive" />
                </Button>
              </li>
            ))}
          </ol>
        )}

        {privateOnShared && (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            فيه تقارير خاصة بيك في اللوحة دي — مش هتظهر لزمايلك غير لما تشاركها من باني التقارير.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button disabled={pending || !nameAr.trim()} onClick={save}><Icon name="Check" className="size-4" />احفظ</Button>
          <Button variant="ghost" onClick={() => router.push(view)}>رجوع</Button>
          <Button variant="ghost" className="ms-auto text-destructive" disabled={pending} onClick={remove}>
            <Icon name="Trash2" className="size-4" />امسح اللوحة
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
