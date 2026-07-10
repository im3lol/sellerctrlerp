import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, users } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RequisitionRowActions } from "@/components/erp/requisition-row-actions";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, APPROVED: { label: "معتمد", variant: "default" },
};

export default async function RequisitionsPage() {
  const { orgId, can } = await requireErpModule("purchases.view");
  const canManage = can("purchases.create");

  const rows = await db
    .select({
      id: materialRequests.id, number: materialRequests.number, date: materialRequests.date, status: materialRequests.status,
      notes: materialRequests.notes, requester: users.name,
      lineCount: sql<number>`(select count(*) from ${materialRequestLines} where ${materialRequestLines.materialRequestId} = ${materialRequests.id})`,
    })
    .from(materialRequests)
    .leftJoin(users, eq(users.id, materialRequests.requestedBy))
    .where(eq(materialRequests.organizationId, orgId))
    .orderBy(desc(materialRequests.date), desc(materialRequests.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader
        icon="ClipboardList" title="طلبات المواد" subtitle={`${rows.length} طلب`} backHref="/erp/purchases"
        action={canManage ? <Button asChild><Link href="/erp/purchases/requisitions/new"><Icon name="Plus" className="size-4" />طلب جديد</Link></Button> : undefined}
      />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد طلبات مواد بعد.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">الرقم</TableHead>
                  <TableHead className="text-start">التاريخ</TableHead>
                  <TableHead className="text-start">مقدّم الطلب</TableHead>
                  <TableHead className="text-start">البنود</TableHead>
                  <TableHead className="text-start">الحالة</TableHead>
                  {canManage && <TableHead className="text-start">إجراءات</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const st = ST[r.status] ?? ST.DRAFT;
                  return (
                    <TableRow key={r.id}>
                      <TableCell><Link href={`/erp/purchases/requisitions/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                      <TableCell>{dt(r.date)}</TableCell>
                      <TableCell>{r.requester ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{Number(r.lineCount)}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      {canManage && <TableCell><RequisitionRowActions id={r.id} status={r.status} canManage={canManage} /></TableCell>}
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
