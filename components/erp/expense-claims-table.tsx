"use client";

import Link from "next/link";
import { bulkExpenseClaimsAction } from "@/app/actions/erp/expense-claims";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpenseClaimRowActions } from "@/components/erp/expense-claim-row-actions";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";

type Row = { id: string; number: string; date: unknown; employee: string; status: string; total: string };

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Only DRAFT claims are selectable — bulkExpenseClaimsAction skips ineligible rows.
export function ExpenseClaimsTable({ rows, canApprove, canCreate }: { rows: Row[]; canApprove: boolean; canCreate: boolean }) {
  const sel = useSelection();
  const pageIds = rows.map((r) => r.id);
  const showSelect = canApprove || canCreate;
  const ops = [
    ...(canApprove ? [{ op: "approve", label: "اعتماد", icon: "Check" } as const] : []),
    ...(canCreate ? [{ op: "delete", label: "حذف", icon: "Trash2", danger: true } as const] : []),
  ];

  return (
    <>
      {showSelect && <BulkBar ids={sel.ids} ops={ops} action={bulkExpenseClaimsAction} onDone={sel.clear} entity="مطالبة" />}
      <Table>
        <TableHeader><TableRow>
          {showSelect && <TableHead className="w-10"><SelectBox checked={sel.allOf(pageIds)} indeterminate={sel.someOf(pageIds)} onChange={() => sel.togglePage(pageIds)} label="تحديد الكل" /></TableHead>}
          <TableHead className="text-start">الرقم</TableHead><TableHead className="text-start">التاريخ</TableHead>
          <TableHead className="text-start">الموظف</TableHead><TableHead className="text-end">الإجمالي</TableHead>
          <TableHead className="text-start">الحالة</TableHead>{showSelect && <TableHead className="text-start">إجراءات</TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const selectable = showSelect;
            return (
              <TableRow key={r.id} data-state={selectable && sel.has(r.id) ? "selected" : undefined}>
                {showSelect && <TableCell>{selectable && <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />}</TableCell>}
                <TableCell><Link href={`/hr/expense-claims/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell>{r.employee}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={r.status === "APPROVED" ? "default" : "secondary"}>{r.status === "APPROVED" ? "معتمد" : "مسودة"}</Badge></TableCell>
                {showSelect && <TableCell><ExpenseClaimRowActions id={r.id} status={r.status} canManage={showSelect} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
