import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { requireErpModule } from "@/lib/erp/org";
import { db } from "@/lib/db";
import { leaveRequests } from "@/db/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { ErpPageHeader } from "@/components/erp/page-header";
import { LeaveRequestRowActions } from "@/components/erp/leave-request-row-actions";
import { LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL } from "@/lib/erp/leave";

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const statusVariant = (s: string) => (s === "APPROVED" ? "default" : s === "REJECTED" ? "destructive" : "secondary");

export default async function LeaveRequestsPage() {
  const { orgId, can } = await requireErpModule("hr.view");
  const canManage = can("hr.post");

  const rows = await db.select({
    id: leaveRequests.id, number: leaveRequests.number, employee: leaveRequests.employeeName,
    type: leaveRequests.leaveType, start: leaveRequests.startDate, end: leaveRequests.endDate,
    days: leaveRequests.days, status: leaveRequests.status,
  }).from(leaveRequests).where(eq(leaveRequests.organizationId, orgId)).orderBy(desc(leaveRequests.startDate), desc(leaveRequests.number));

  return (
    <div className="space-y-6">
      <ErpPageHeader icon="CalendarDays" title="إجازات الموظفين" subtitle={`${rows.length} طلب`} backHref="/erp/hr/employees"
        action={can("hr.create") ? <Button asChild><Link href="/erp/hr/leaves/new"><Icon name="Plus" className="size-4" />طلب إجازة</Link></Button> : undefined} />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">لا توجد طلبات إجازة بعد.</div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">الموظف</TableHead>
                <TableHead className="text-start">النوع</TableHead><TableHead className="text-start">من</TableHead>
                <TableHead className="text-start">إلى</TableHead><TableHead className="text-end">أيام</TableHead>
                <TableHead className="text-start">الحالة</TableHead>{canManage && <TableHead className="text-start">إجراءات</TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{r.employee}</TableCell>
                    <TableCell>{LEAVE_TYPE_LABEL[r.type] ?? r.type}</TableCell>
                    <TableCell>{dt(r.start)}</TableCell>
                    <TableCell>{dt(r.end)}</TableCell>
                    <TableCell className="text-end tabular-nums">{r.days}</TableCell>
                    <TableCell><Badge variant={statusVariant(r.status)}>{LEAVE_STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                    {canManage && <TableCell><LeaveRequestRowActions id={r.id} status={r.status} canManage={canManage} /></TableCell>}
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
