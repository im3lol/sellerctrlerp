"use client";

import Link from "next/link";
import { bulkDeleteMaterialRequestsAction } from "@/app/actions/erp/material-requests";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BulkDeleteBar, SelectBox, useSelection } from "@/components/erp/bulk-select";
import { RequisitionRowActions } from "@/components/erp/requisition-row-actions";

type Row = { id: string; number: string; date: unknown; status: string; notes: string | null; requester: string | null; lineCount: number };

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, APPROVED: { label: "معتمد", variant: "default" },
};

export function MaterialRequestsTable({ rows, canDelete }: { rows: Row[]; canDelete: boolean }) {
  const sel = useSelection();
  const ids = rows.map((r) => r.id);

  return (
    <div>
      {canDelete && sel.size > 0 && (
        <BulkDeleteBar ids={sel.ids} action={bulkDeleteMaterialRequestsAction} onDone={sel.clear} entity="طلب مواد" />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canDelete && (
              <TableHead className="w-10">
                <SelectBox checked={sel.allOf(ids)} indeterminate={sel.someOf(ids)} onChange={() => sel.togglePage(ids)} label="تحديد الكل" />
              </TableHead>
            )}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">مقدّم الطلب</TableHead>
            <TableHead className="text-start">البنود</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            {canDelete && <TableHead className="text-start">إجراءات</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = ST[r.status] ?? ST.DRAFT;
            const checked = sel.has(r.id);
            return (
              <TableRow key={r.id} data-state={checked ? "selected" : undefined}>
                {canDelete && (
                  <TableCell>
                    <SelectBox checked={checked} onChange={() => sel.toggle(r.id)} label="تحديد" />
                  </TableCell>
                )}
                <TableCell><Link href={`/erp/purchases/requisitions/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell>{r.requester ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{Number(r.lineCount)}</TableCell>
                <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                {canDelete && <TableCell><RequisitionRowActions id={r.id} status={r.status} canManage={canDelete} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
