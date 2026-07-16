import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { leaveRequests } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LeavesTable } from "@/components/erp/leaves-table";

export default async function LeaveRequestsPage() {
  const { orgId, can } = await requireErpModule("hr.view");
  const canManage = can("hr.post") || can("hr.create");

  const rows = await db.select({
    id: leaveRequests.id, number: leaveRequests.number, employee: leaveRequests.employeeName,
    type: leaveRequests.leaveType, start: leaveRequests.startDate, end: leaveRequests.endDate,
    days: leaveRequests.days, status: leaveRequests.status,
  }).from(leaveRequests).where(eq(leaveRequests.organizationId, orgId)).orderBy(desc(leaveRequests.startDate), desc(leaveRequests.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="CalendarDays" title="إجازات الموظفين" subtitle={`${rows.length} طلب`} backHref="/erp/hr"
        action={
          <div className="flex gap-2">
            <Button asChild variant="outline"><Link href="/erp/hr/leaves/report"><Icon name="BarChart3" className="size-4" />التقرير</Link></Button>
            {can("hr.create") && <Button asChild><Link href="/erp/hr/leaves/new"><Icon name="Plus" className="size-4" />طلب إجازة</Link></Button>}
          </div>
        } />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد طلبات إجازة بعد.</div>
          ) : (
            <LeavesTable rows={rows} canManage={canManage} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
