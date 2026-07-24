"use client";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExpenseRowActions } from "@/components/erp/expense-row-actions";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";
import { bulkExpensesAction, type ExpensesFilter } from "@/app/actions/erp/expenses";

type Row = { id: string; number: string; date: Date; amount: string | null; status: string; payee: string | null; category: string | null; paidFrom: string | null };

const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

export function ExpensesTable({ rows, canDelete, total, filter }: { rows: Row[]; canDelete: boolean; total: number; filter: ExpensesFilter }) {
  const sel = useSelection(total);
  const ids = rows.map((r) => r.id);

  return (
    <>
      {canDelete && (
        <BulkBar
          ids={sel.ids}
          ops={[{ op: "confirm", label: "تأكيد", icon: "Check" }, { op: "delete", label: "حذف", icon: "Trash2", danger: true }]}
          action={(op, opIds, allPages) => bulkExpensesAction(op, allPages ? [] : opIds, allPages ? filter : undefined)}
          onDone={sel.clear}
          entity="مصروف"
          all={{ total, active: sel.allPages, canOffer: sel.allOf(ids) && total > ids.length, onSelectAll: sel.selectAllPages }}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {canDelete && (
              <TableHead className="w-10">
                <SelectBox checked={sel.allOf(ids)} indeterminate={sel.someOf(ids)} onChange={() => sel.togglePage(ids)} label="تحديد كل الصفحة" />
              </TableHead>
            )}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">البند</TableHead>
            <TableHead className="text-start">المستفيد</TableHead>
            <TableHead className="text-start">الدفع من</TableHead>
            <TableHead className="text-start">المبلغ</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            {canDelete && <TableHead className="text-start">إجراءات</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
              {canDelete && (
                <TableCell>
                  <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />
                </TableCell>
              )}
              <TableCell className="font-mono">{r.number}</TableCell>
              <TableCell>{dt(r.date)}</TableCell>
              <TableCell>{r.category ?? "—"}</TableCell>
              <TableCell>{r.payee ?? "—"}</TableCell>
              <TableCell>{r.paidFrom ?? "—"}</TableCell>
              <TableCell>{fmt(r.amount)}</TableCell>
              <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
              {canDelete && <TableCell><ExpenseRowActions id={r.id} status={r.status} canManage /></TableCell>}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
