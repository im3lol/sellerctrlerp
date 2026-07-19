import { notFound } from "next/navigation";
import { and, asc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, items, users } from "@/db/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErpPageHeader } from "@/components/erp/page-header";
import { RequisitionRowActions } from "@/components/erp/requisition-row-actions";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const q = (n: number) => n.toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

export default async function RequisitionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
    const [mr] = await db.select({
      id: materialRequests.id, number: materialRequests.number, date: materialRequests.date, status: materialRequests.status,
      notes: materialRequests.notes, requester: users.name,
    }).from(materialRequests).leftJoin(users, sql`${users.id}::text = ${materialRequests.requestedBy}`)
      .where(and(eq(materialRequests.id, id), eq(materialRequests.organizationId, orgId))).limit(1);
    if (!mr) notFound();

    const lines = await db.select({ name: items.nameAr, code: items.code, quantity: materialRequestLines.quantity })
      .from(materialRequestLines).innerJoin(items, eq(items.id, materialRequestLines.itemId))
      .where(eq(materialRequestLines.materialRequestId, id)).orderBy(asc(items.code));

    return (
      <div className="space-y-6">
        <ErpPageHeader icon="ClipboardList" title={`طلب مواد ${mr.number}`} subtitle={`${mr.requester ?? "—"} · ${dt(mr.date)}`} backHref="/purchases/requisitions"
          action={<RequisitionRowActions id={mr.id} status={mr.status} canManage={can("purchases.create")} />} />
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>البنود المطلوبة</CardTitle>
            <Badge variant={mr.status === "APPROVED" ? "default" : "secondary"}>{mr.status === "APPROVED" ? "معتمد" : "مسودة"}</Badge>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead className="text-start">الصنف</TableHead><TableHead className="text-end">الكمية</TableHead></TableRow></TableHeader>
              <TableBody>
                {lines.map((l, i) => (
                  <TableRow key={i}><TableCell><span className="font-mono text-xs text-muted-foreground">{l.code}</span> {l.name}</TableCell><TableCell className="text-end tabular-nums">{q(Number(l.quantity))}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
            {mr.notes && <p className="mt-4 text-sm text-muted-foreground">ملاحظات: {mr.notes}</p>}
          </CardContent>
        </Card>
      </div>
    );
  });
}
