"use client";

import Link from "next/link";
import { bulkStockAdjustmentsAction } from "@/app/actions/erp/stock-adjustments";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";

type Row = {
  id: string;
  number: string;
  date: Date;
  totalValue: string | number | null;
  reason: string | null;
  status: string;
  count: number;
  delta: number;
};

const fmt = (v: string | number | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intl = (n: number) => n.toLocaleString("ar-EG-u-nu-latn");
const dt = (d: Date) => new Date(d).toLocaleDateString("ar-EG-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export function AdjustmentsTable({ rows, canManage }: { rows: Row[]; canManage: boolean }) {
  const sel = useSelection();
  const draftIds = rows.filter((r) => r.status === "DRAFT").map((r) => r.id);
  const showSelect = canManage && draftIds.length > 0;

  return (
    <>
      {showSelect && (
        <BulkBar
          ids={sel.ids}
          ops={[{ op: "confirm", label: "ترحيل", icon: "Check" }, { op: "delete", label: "حذف", icon: "Trash2", danger: true }]}
          action={bulkStockAdjustmentsAction}
          onDone={sel.clear}
          entity="تسوية"
        />
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {showSelect && (
              <TableHead className="w-10">
                <SelectBox checked={sel.allOf(draftIds)} indeterminate={sel.someOf(draftIds)} onChange={() => sel.togglePage(draftIds)} label="تحديد كل المسودات" />
              </TableHead>
            )}
            <TableHead className="text-start">الرقم</TableHead>
            <TableHead className="text-start">التاريخ</TableHead>
            <TableHead className="text-start">الوصف</TableHead>
            <TableHead className="text-start">عدد الأصناف</TableHead>
            <TableHead className="text-start">صافي الفرق</TableHead>
            <TableHead className="text-start">القيمة</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead className="text-start"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const selectable = showSelect && r.status === "DRAFT";
            return (
              <TableRow key={r.id} data-state={selectable && sel.has(r.id) ? "selected" : undefined}>
                {showSelect && (
                  <TableCell>
                    {selectable && <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />}
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/erp/inventory/adjustments/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{dt(r.date)}</TableCell>
                <TableCell><Badge variant="secondary">{r.reason ?? "—"}</Badge></TableCell>
                <TableCell>{intl(r.count)}</TableCell>
                <TableCell className={r.delta < 0 ? "text-destructive" : r.delta > 0 ? "text-emerald-600" : ""}>{r.delta > 0 ? "+" : ""}{intl(r.delta)}</TableCell>
                <TableCell>{fmt(r.totalValue)}</TableCell>
                <TableCell><Badge variant={r.status === "POSTED" ? "default" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : "مسودة"}</Badge></TableCell>
                <TableCell>
                  <Link href={`/erp/inventory/adjustments/${r.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
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
