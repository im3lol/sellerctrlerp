import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { journalEntries, journalEntryLines } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّل", variant: "default" },
  REVERSED: { label: "معكوس", variant: "destructive" },
};
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function JournalPage() {
  const { orgId, role } = await requireErpModule("accounting.view");
  const rows = await db
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      date: journalEntries.date,
      description: journalEntries.description,
      status: journalEntries.status,
      total: sql<string>`coalesce(sum(${journalEntryLines.debit}), 0)`,
    })
    .from(journalEntries)
    .leftJoin(journalEntryLines, eq(journalEntryLines.journalEntryId, journalEntries.id))
    .where(eq(journalEntries.organizationId, orgId))
    .groupBy(journalEntries.id)
    .orderBy(desc(journalEntries.date), desc(journalEntries.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="BookText"
        title="القيود اليومية"
        subtitle={`${rows.length} قيد`}
        action={
          erpCan(role, "accounting.create") ? (
            <Button asChild>
              <Link href="/erp/accounting/journal/new">
                <Icon name="Plus" className="size-4" />قيد جديد
              </Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>دفتر اليومية</CardTitle>
          <CardDescription>القيود المحاسبية للمؤسسة النشطة (تشمل المُرحّلة تلقائياً من الفواتير).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد قيود بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">البيان</TableHead>
                  <TableHead className="text-start">المبلغ</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
                  return (
                    <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell className="font-mono">
                        <Link href={`/erp/accounting/journal/${r.id}`} className="text-primary hover:underline">
                          {r.number}
                        </Link>
                      </TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.description ?? "—"}</TableCell>
                      <TableCell>{fmt(r.total)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
