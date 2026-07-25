"use client";

import Link from "next/link";
import { bulkJournalAction, type JournalFilter } from "@/app/actions/erp/journal";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";

type Row = { id: string; number: string; date: Date; description: string | null; status: string; sourceType: string | null; total: string };

const STATUS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" },
  POSTED: { label: "مرحّل", variant: "default" },
  REVERSED: { label: "معكوس", variant: "destructive" },
};
const SOURCE: Record<string, string> = {
  MANUAL: "قيد يدوي",
  SALES_INVOICE: "فاتورة بيع",
  PURCHASE_INVOICE: "فاتورة شراء",
  RECEIPT_VOUCHER: "سند قبض",
  PAYMENT_VOUCHER: "سند صرف",
  SALES_RETURN: "مرتجع مبيعات",
  PURCHASE_RETURN: "مرتجع مشتريات",
  REVERSAL: "قيد عكسي",
  STOCK_ADJUSTMENT: "تسوية مخزون",
  GOODS_RECEIPT: "استلام بضاعة",
  DELIVERY_COGS: "ت.ب.م تسليم",
  OPENING_BALANCE: "رصيد افتتاحي",
};
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

// Only DRAFT entries are deletable — deleteDraftEntryAction rejects posted ones.
export function JournalTable({ rows, canDelete, total, filter }: { rows: Row[]; canDelete: boolean; total: number; filter: JournalFilter }) {
  const sel = useSelection(total);
  const pageIds = rows.map((r) => r.id);
  const showSelect = canDelete;

  return (
    <>
      {showSelect && (
        <BulkBar
          ids={sel.ids}
          ops={[{ op: "post", label: "ترحيل", icon: "Check" }, { op: "delete", label: "حذف", icon: "Trash2", danger: true }]}
          action={(op, ids, allPages) => bulkJournalAction(op, allPages ? [] : ids, allPages ? filter : undefined)}
          onDone={sel.clear}
          entity="قيد"
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
            <TableHead className="text-start">البيان</TableHead>
            <TableHead className="text-start">المصدر</TableHead>
            <TableHead className="text-start">المبلغ</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = STATUS[r.status] ?? { label: r.status, variant: "secondary" as const };
            const selectable = showSelect;
            return (
              <TableRow key={r.id} data-state={selectable && sel.has(r.id) ? "selected" : undefined} className="hover:bg-muted/50">
                {showSelect && (
                  <TableCell>
                    {selectable && <SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" />}
                  </TableCell>
                )}
                <TableCell className="font-mono">
                  <Link href={`/accounting/journal/${encodeURIComponent(r.number)}`} className="text-primary hover:underline">{r.number}</Link>
                </TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell className="max-w-72 truncate">{r.description ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{SOURCE[r.sourceType ?? ""] ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
