"use client";

import { bulkLeaveRequestsAction } from "@/app/actions/erp/leave-requests";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LeaveRequestRowActions } from "@/components/erp/leave-request-row-actions";
import { LEAVE_TYPE_LABEL, LEAVE_STATUS_LABEL } from "@/lib/erp/leave";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";

type Row = { id: string; number: string; employee: string; type: string; start: unknown; end: unknown; days: unknown; status: string };

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const statusVariant = (s: string) => (s === "APPROVED" ? "default" : s === "REJECTED" ? "destructive" : "secondary");

// Only DRAFT requests are selectable — bulkLeaveRequestsAction skips ineligible rows.
export function LeavesTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const sel = useSelection();
  const draftIds = rows.filter((r) => r.status === "DRAFT").map((r) => r.id);
  const showSelect = canManage && draftIds.length > 0;

  return (
    <>
      {showSelect && <BulkBar ids={sel.ids} ops={[{ op: "approve", label: "اعتماد", icon: "Check" }, { op: "reject", label: "رفض", icon: "X" }, { op: "delete", label: "حذف", icon: "Trash2", danger: true }]} action={bulkLeaveRequestsAction} onDone={sel.clear} entity="طلب إجازة" />}
      <Table>
        <TableHeader><TableRow>
          {showSelect && <TableHead className="w-10"><SelectBox checked={sel.allOf(draftIds)} indeterminate={sel.someOf(draftIds)} onChange={() => sel.togglePage(draftIds)} label="تحديد كل المسودات" /></TableHead>}
          <TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">الموظف</TableHead>
          <TableHead className="text-start">النوع</TableHead><TableHead className="text-start">من</TableHead>
          <TableHead className="text-start">إلى</TableHead><TableHead className="text-end">أيام</TableHead>
          <TableHead className="text-start">الحالة</TableHead>{canManage && <TableHead className="text-start">إجراءات</TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const selectable = showSelect && r.status === "DRAFT";
            return (
              <TableRow key={r.id} data-state={selectable && sel.has(r.id) ? "selected" : undefined}>
                {showSelect && <TableCell>{selectable && <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />}</TableCell>}
                <TableCell className="font-mono">{r.number}</TableCell>
                <TableCell>{r.employee}</TableCell>
                <TableCell>{LEAVE_TYPE_LABEL[r.type] ?? r.type}</TableCell>
                <TableCell>{dt(r.start)}</TableCell>
                <TableCell>{dt(r.end)}</TableCell>
                <TableCell className="text-end tabular-nums">{r.days as number}</TableCell>
                <TableCell><Badge variant={statusVariant(r.status)}>{LEAVE_STATUS_LABEL[r.status] ?? r.status}</Badge></TableCell>
                {canManage && <TableCell><LeaveRequestRowActions id={r.id} status={r.status} canManage={canManage} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
