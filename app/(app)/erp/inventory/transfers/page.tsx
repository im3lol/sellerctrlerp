import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requireErpModule, erpCan } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { stockTransfers, stockTransferLines, warehouses } from "@/db/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";

const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export default async function TransfersPage() {
  const { orgId, role } = await requireErpModule("inventory.view");
  const fromWh = alias(warehouses, "from_wh");
  const toWh = alias(warehouses, "to_wh");
  const rows = await db
    .select({
      id: stockTransfers.id,
      number: stockTransfers.number,
      date: stockTransfers.date,
      from: fromWh.nameAr,
      to: toWh.nameAr,
      notes: stockTransfers.notes,
      lineCount: sql<number>`count(${stockTransferLines.id})`,
    })
    .from(stockTransfers)
    .leftJoin(fromWh, eq(fromWh.id, stockTransfers.fromWarehouseId))
    .leftJoin(toWh, eq(toWh.id, stockTransfers.toWarehouseId))
    .leftJoin(stockTransferLines, eq(stockTransferLines.stockTransferId, stockTransfers.id))
    .where(eq(stockTransfers.organizationId, orgId))
    .groupBy(stockTransfers.id, fromWh.nameAr, toWh.nameAr)
    .orderBy(desc(stockTransfers.date), desc(stockTransfers.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ArrowLeftRight"
        title="التحويلات المخزنية"
        subtitle={`${rows.length} تحويل`}
        action={
          erpCan(role, "inventory.create") ? (
            <Button asChild>
              <Link href="/erp/inventory/transfers/new"><Icon name="Plus" className="size-4" />تحويل جديد</Link>
            </Button>
          ) : undefined
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>سجل التحويلات</CardTitle>
          <CardDescription>نقل البضاعة بين المستودعات بنفس التكلفة (لا يؤثّر على إجمالي قيمة المخزون).</CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد تحويلات بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">من</TableHead>
                  <TableHead className="text-start">إلى</TableHead>
                  <TableHead className="text-start">عدد الأصناف</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{dt(r.date)}</TableCell>
                    <TableCell>{r.from ?? "—"}</TableCell>
                    <TableCell>{r.to ?? "—"}</TableCell>
                    <TableCell>{Number(r.lineCount).toLocaleString("ar-EG-u-nu-latn")}</TableCell>
                    <TableCell><Badge variant="default">مرحّل</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
