import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Server component: recent sync-run history for one platform (durable sync_runs log).

const KIND_AR: Record<string, string> = {
  IMPORT: "استيراد كامل",
  DISCOVERY: "اكتشاف منتجات",
  DETAILS: "تفاصيل الأصناف",
  IMAGES: "الصور",
  PRICING: "الرسوم",
  INVENTORY: "تدقيق المخزون",
  ORDERS: "المبيعات",
  SETTLEMENTS: "التسويات",
  RETURNS: "المرتجعات",
  REIMBURSEMENTS: "التعويضات",
  LEDGER: "دفتر FBA",
};

export type SyncRunRow = {
  id: string;
  kind: string;
  status: string;
  productsProcessed: number;
  newProducts: number;
  updatedProducts: number;
  apiRequests: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

const dt = (d: Date) => new Date(d).toLocaleString("ar-EG-u-nu-latn", { dateStyle: "short", timeStyle: "short" });

function duration(start: Date, end: Date | null): string {
  if (!end) return "—";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s} ث` : `${Math.floor(s / 60)} د ${s % 60} ث`;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "OK") return <Badge className="bg-emerald-600">تمت</Badge>;
  if (status === "RUNNING") return <Badge variant="secondary">جارية</Badge>;
  return <Badge variant="destructive">فشلت</Badge>;
}

export function SyncRunsTable({ rows }: { rows: SyncRunRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>سجل المزامنات</CardTitle>
        <CardDescription>آخر {rows.length} تشغيلة — النوع والنتيجة والعدادات ومدة التنفيذ.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed py-8 text-center text-muted-foreground">لا توجد مزامنات بعد.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>معالج</TableHead>
                <TableHead>جديد</TableHead>
                <TableHead>محدّث</TableHead>
                <TableHead>طلبات API</TableHead>
                <TableHead>المدة</TableHead>
                <TableHead>بدأت في</TableHead>
                <TableHead>الخطأ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{KIND_AR[r.kind] ?? r.kind}</TableCell>
                  <TableCell><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="tabular-nums">{r.productsProcessed}</TableCell>
                  <TableCell className="tabular-nums">{r.newProducts}</TableCell>
                  <TableCell className="tabular-nums">{r.updatedProducts}</TableCell>
                  <TableCell className="tabular-nums">{r.apiRequests}</TableCell>
                  <TableCell className="tabular-nums">{duration(r.startedAt, r.finishedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{dt(r.startedAt)}</TableCell>
                  <TableCell className="max-w-56 truncate text-destructive" title={r.error ?? undefined}>{r.error ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
