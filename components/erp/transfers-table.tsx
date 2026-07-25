"use client";

import Link from "next/link";
import { bulkStockTransfersAction, type TransfersFilter } from "@/app/actions/erp/stock-transfers";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";

type Row = {
  id: string;
  number: string;
  date: Date;
  notes: string | null;
  status: string;
  count: number;
};

const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export function TransfersTable({ rows, canConfirm, canCreate, total, filter }: { rows: Row[]; canConfirm: boolean; canCreate: boolean; total: number; filter: TransfersFilter }) {
  const sel = useSelection(total);
  const pageIds = rows.map((r) => r.id);
  const showSelect = canConfirm || canCreate;
  const ops = [
    ...(canConfirm ? [{ op: "confirm", label: "ترحيل", icon: "Check" } as const] : []),
    ...(canCreate ? [{ op: "delete", label: "حذف", icon: "Trash2", danger: true } as const] : []),
  ];

  return (
    <>
      {showSelect && (
        <BulkBar
          ids={sel.ids}
          ops={ops}
          action={(op, ids, allPages) => bulkStockTransfersAction(op, allPages ? [] : ids, allPages ? filter : undefined)}
          onDone={sel.clear}
          entity="تحويل"
          all={{ total, active: sel.allPages, canOffer: sel.allOf(pageIds) && total > pageIds.length, onSelectAll: sel.selectAllPages }}
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {showSelect && (
              <TableHead className="w-10">
                <SelectBox checked={sel.allOf(pageIds)} indeterminate={sel.someOf(pageIds)} onChange={() => sel.togglePage(pageIds)} label="تحديد الكل" />
              </TableHead>
            )}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">عدد الأصناف</TableHead>
            <TableHead className="text-start">ملاحظات</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead className="text-start"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const selectable = showSelect;
            return (
              <TableRow key={r.id} data-state={selectable && sel.has(r.id) ? "selected" : undefined}>
                {showSelect && (
                  <TableCell>
                    {selectable && <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />}
                  </TableCell>
                )}
                <TableCell><Link href={`/inventory/transfers/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                <TableCell>{intl(r.count)}</TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground">{r.notes ?? "—"}</TableCell>
                <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                <TableCell>
                  <Link href={`/inventory/transfers/${r.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
                    {r.status === "DRAFT" ? "مراجعة وتأكيد" : "عرض"}<Icon name="ChevronLeft" className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
