import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getT } from "@/lib/i18n/server";
import { db } from "@/lib/db";
import { withPlatformScope } from "@/lib/db-scope";
import { runHealthChecks, type HealthCheck, type HealthGroup, type HealthStatus } from "@/lib/system-health";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const STATUS: Record<HealthStatus, { label: string; dot: string; banner: string; icon: string }> = {
  pass: { label: "يعمل", dot: "bg-emerald-500", banner: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", icon: "CheckCircle2" },
  warn: { label: "تحذير", dot: "bg-amber-500", banner: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", icon: "AlertTriangle" },
  fail: { label: "عطل", dot: "bg-red-500", banner: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300", icon: "XCircle" },
};
const OVERALL: Record<HealthStatus, string> = {
  pass: "كل الأنظمة تعمل بشكل طبيعي",
  warn: "النظام يعمل مع تحذيرات تحتاج متابعة",
  fail: "يوجد عطل في جزء من النظام",
};
const GROUPS: { key: HealthGroup; title: string; icon: string }[] = [
  { key: "core", title: "الخدمات الأساسية", icon: "Server" },
  { key: "server", title: "موارد السيرفر", icon: "Cpu" },
  { key: "network", title: "الشبكة والخدمات الخارجية", icon: "Globe" },
  { key: "data", title: "البيانات والنسخ الاحتياطي", icon: "Database" },
];
const fmtBytes = (b: number) => b < 1024 ** 2 ? `${(b / 1024).toFixed(0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`;

export default async function SystemPage() {
  if ((await getCurrentUser())?.role !== "system_admin") redirect("/login/admin");
  // Platform scope: the checks read across companies (platform links, backups) and
  // document_attachments is RLS-policied.
  return withPlatformScope(() => render());
}

function CheckCard({ c, t }: { c: HealthCheck; t: (s: string) => string }) {
  const s = STATUS[c.status];
  return (
    <Card className={c.status === "pass" ? undefined : c.status === "warn" ? "border-amber-500/50" : "border-red-500/60"}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`size-2.5 shrink-0 rounded-full ${s.dot}`} aria-hidden />
            <span className="font-semibold">{c.label}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums" dir="ltr">{c.ms} ms</span>
            <span className={`rounded-full border px-2 py-0.5 font-medium ${s.banner}`}>{t(s.label)}</span>
          </div>
        </div>
        <p className="text-sm">{c.summary}</p>
        {c.details.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            {c.details.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="min-w-0 break-words text-start font-medium" dir="auto">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {c.hint && (
          <div className="flex gap-2 rounded-lg bg-muted/60 p-2.5 text-xs">
            <Icon name="Lightbulb" className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
            <span><span className="font-semibold">{t("تعمل إيه:")} </span>{c.hint}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

async function render() {
  const t = await getT();
  const { checks, overall, at } = await runHealthChecks();
  const perOrg = await db.execute<{ name: string; bytes: number; files: number }>(sql`
    SELECT o.name_ar AS name, coalesce(sum(a.file_size),0)::bigint AS bytes, count(a.id)::int AS files
    FROM organizations o LEFT JOIN document_attachments a ON a.organization_id = o.id
    GROUP BY o.id, o.name_ar ORDER BY bytes DESC
  `).then((r) => r.rows);
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  const o = STATUS[overall];

  return (
    <div className="space-y-6">
      <PageHeader title={t("حالة النظام")} description={t("فحص حي لكل أجزاء النظام: الخدمات، السيرفر، الشبكة، والنسخ الاحتياطي.")} />

      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 ${o.banner}`}>
        <div className="flex items-center gap-3">
          <Icon name={o.icon} className="size-6" />
          <div>
            <div className="text-lg font-bold">{t(OVERALL[overall])}</div>
            <div className="text-sm opacity-80">{counts.pass} {t("يعمل")} · {counts.warn} {t("تحذير")} · {counts.fail} {t("عطل")}</div>
          </div>
        </div>
        <AutoRefresh at={at} />
      </div>

      {GROUPS.map((g) => {
        const list = checks.filter((c) => c.group === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} className="space-y-3">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Icon name={g.icon} className="size-4 text-muted-foreground" />{t(g.title)}</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {list.map((c) => <CheckCard key={c.key} c={c} t={t} />)}
            </div>
          </section>
        );
      })}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{t("التخزين حسب المؤسسة")}</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead className="text-start">{t("المؤسسة")}</TableHead><TableHead className="text-start">{t("الملفات")}</TableHead><TableHead className="text-start">{t("الحجم")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {perOrg.map((r) => (
                <TableRow key={r.name}><TableCell className="font-medium">{r.name}</TableCell><TableCell className="tabular-nums">{Number(r.files).toLocaleString("ar-EG-u-nu-latn")}</TableCell><TableCell className="tabular-nums" dir="ltr">{fmtBytes(Number(r.bytes))}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
