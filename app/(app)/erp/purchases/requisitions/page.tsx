import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, users } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { MaterialRequestsTable } from "@/components/erp/material-requests-table";

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
    .leftJoin(users, sql`${users.id}::text = ${materialRequests.requestedBy}`)
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
            <MaterialRequestsTable rows={rows} canDelete={canManage} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
