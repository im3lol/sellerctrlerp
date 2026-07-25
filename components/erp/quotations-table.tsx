"use client";

import Link from "next/link";
import { bulkQuotationsAction } from "@/app/actions/erp/quotations";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";
import { QuotationRowActions } from "@/components/erp/quotation-row-actions";

type Row = { id: string; number: string; date: unknown; validUntil: unknown; status: string; customer: string | null; total: string };

const dt = (d: unknown) => new Date(d as string).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });
const fmt = (v: unknown) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ST: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  DRAFT: { label: "مسودة", variant: "secondary" }, SENT: { label: "مُرسل", variant: "outline" },
  ACCEPTED: { label: "مقبول", variant: "default" }, REJECTED: { label: "مرفوض", variant: "destructive" },
};

export function QuotationsTable({ rows, canConfirm, canCreate }: { rows: Row[]; canConfirm: boolean; canCreate: boolean }) {
  const sel = useSelection();
  const ids = rows.map((r) => r.id);
  const showSelect = canConfirm || canCreate;
  const ops = [
    ...(canConfirm ? [{ op: "accept", label: "قبول", icon: "Check" } as const, { op: "reject", label: "رفض", icon: "X" } as const] : []),
    ...(canCreate ? [{ op: "delete", label: "حذف", icon: "Trash2", danger: true } as const] : []),
  ];

  return (
    <div>
      {showSelect && <BulkBar ids={sel.ids} ops={ops} action={bulkQuotationsAction} onDone={sel.clear} entity="عرض" />}
      <Table>
        <TableHeader><TableRow>
          {showSelect && (
            <TableHead className="w-10"><SelectBox checked={sel.allOf(ids)} indeterminate={sel.someOf(ids)} onChange={() => sel.togglePage(ids)} label="تحديد الكل" /></TableHead>
          )}
          <TableHead className="text-start">الرقم</TableHead>
          <TableHead className="text-start">التاريخ</TableHead>
          <TableHead className="text-start">العميل</TableHead>
          <TableHead className="text-start">صالح حتى</TableHead>
          <TableHead className="text-end">الإجمالي</TableHead>
          <TableHead className="text-start">الحالة</TableHead>
          {showSelect && <TableHead className="text-start">إجراءات</TableHead>}
        </TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => {
            const st = ST[r.status] ?? ST.DRAFT;
            return (
              <TableRow key={r.id} data-state={sel.has(r.id) ? "selected" : undefined}>
                {showSelect && <TableCell><SelectBox checked={sel.has(r.id)} onChange={() => sel.toggle(r.id)} label="تحديد" /></TableCell>}
                <TableCell><Link href={`/sales/quotations/${r.id}`} className="font-mono hover:text-primary">{r.number}</Link></TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={r.customer ?? undefined}>{r.customer ?? "—"}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{r.validUntil ? dt(r.validUntil) : "—"}</TableCell>
                <TableCell className="text-end tabular-nums font-medium">{fmt(r.total)}</TableCell>
                <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                {showSelect && <TableCell><QuotationRowActions id={r.id} status={r.status} canManage={showSelect} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
