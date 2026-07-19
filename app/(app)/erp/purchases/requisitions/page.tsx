import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { loadErpPage } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { materialRequests, materialRequestLines, users } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { MaterialRequestsTable } from "@/components/erp/material-requests-table";

export default async function RequisitionsPage() {
  return loadErpPage("purchases.view", async ({ orgId, can }) => {
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

    // Rows are already loaded → count stages in JS (draft = awaiting approval).
    const draftCount = rows.filter((r) => r.status === "DRAFT").length;
    const approvedCount = rows.filter((r) => r.status === "APPROVED").length;

    return (
      <div className="space-y-6">
        <ErpPageHeader
          icon="ClipboardList" title="طلبات المواد" subtitle={`${rows.length} طلب`} backHref="/erp/purchases"
          action={canManage ? <Button asChild><Link href="/erp/purchases/requisitions/new"><Icon name="Plus" className="size-4" />طلب جديد</Link></Button> : undefined}
        />

        {rows.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">بانتظار الاعتماد (مسودة)</div><p className="mt-1 text-2xl font-bold tabular-nums text-amber-600">{draftCount.toLocaleString("ar-EG-u-nu-latn")}</p></CardContent></Card>
            <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">معتمدة</div><p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{approvedCount.toLocaleString("ar-EG-u-nu-latn")}</p></CardContent></Card>
          </div>
        )}

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
  });
}
