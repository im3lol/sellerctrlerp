import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { Icon } from "@/components/icon";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const fmtBytes = (b: number) => (b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} ك.ب` : b < 1024 ** 3 ? `${(b / 1024 / 1024).toFixed(1)} م.ب` : `${(b / 1024 ** 3).toFixed(2)} ج.ب`);
const int = (n: number) => n.toLocaleString("ar-EG");

export default async function SystemPage() {
  const [meta] = await db.execute<{ db_size: number; attach_bytes: number; attach_count: number; orgs: number; conns: number }>(sql`
    SELECT
      pg_database_size(current_database()) AS db_size,
      (SELECT coalesce(sum(file_size),0) FROM document_attachments) AS attach_bytes,
      (SELECT count(*)::int FROM document_attachments) AS attach_count,
      (SELECT count(*)::int FROM organizations) AS orgs,
      (SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS conns
  `).then((r) => r.rows);

  // Storage consumed per subscriber.
  const perOrg = await db.execute<{ name: string; bytes: number; files: number }>(sql`
    SELECT o.name_ar AS name, coalesce(sum(a.file_size),0)::bigint AS bytes, count(a.id)::int AS files
    FROM organizations o LEFT JOIN document_attachments a ON a.organization_id = o.id
    GROUP BY o.id, o.name_ar ORDER BY bytes DESC
  `).then((r) => r.rows);

  const cards = [
    { label: "حجم قاعدة البيانات", value: fmtBytes(Number(meta?.db_size ?? 0)), icon: "Database" },
    { label: "التخزين المستهلك", value: fmtBytes(Number(meta?.attach_bytes ?? 0)), icon: "HardDrive", hint: `${int(Number(meta?.attach_count ?? 0))} ملف` },
    { label: "اتصالات قاعدة البيانات", value: int(Number(meta?.conns ?? 0)), icon: "Activity" },
    { label: "المؤسسات", value: int(Number(meta?.orgs ?? 0)), icon: "Building2" },
  ];

  const server = [
    { k: "بيئة التشغيل", v: "خادم ذاتي / Docker" },
    { k: "إصدار Node", v: process.version },
    { k: "المنصة", v: `${process.platform} / ${process.arch}` },
    { k: "البيئة", v: process.env.NODE_ENV ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="أدوات النظام" description="حالة الخادم وقاعدة البيانات والتخزين المستهلك." />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}><CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Icon name={c.icon} className="size-4" />{c.label}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums">{c.value}</div>
            {c.hint && <div className="text-xs text-muted-foreground">{c.hint}</div>}
          </CardContent></Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">الخادم</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table><TableBody>
              {server.map((s) => (
                <TableRow key={s.k}><TableCell className="text-muted-foreground">{s.k}</TableCell><TableCell className="text-start font-medium" dir="ltr">{s.v}</TableCell></TableRow>
              ))}
            </TableBody></Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">التخزين حسب المؤسسة</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead className="text-start">المؤسسة</TableHead><TableHead className="text-start">الملفات</TableHead><TableHead className="text-start">الحجم</TableHead></TableRow></TableHeader>
              <TableBody>
                {perOrg.map((o) => (
                  <TableRow key={o.name}><TableCell className="font-medium">{o.name}</TableCell><TableCell className="tabular-nums">{int(Number(o.files))}</TableCell><TableCell className="tabular-nums">{fmtBytes(Number(o.bytes))}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
