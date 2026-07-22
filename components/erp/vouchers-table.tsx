"use client";

import Link from "next/link";
import { bulkReceiptVouchersAction } from "@/app/actions/erp/receipts";
import { bulkPaymentVouchersAction } from "@/app/actions/erp/payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Icon } from "@/components/icon";
import { useSelection, BulkBar, SelectBox } from "@/components/erp/bulk-select";
import { VoucherRowActions } from "@/components/erp/voucher-row-actions";

export type VoucherRow = { id: string; number: string; date: Date; party: string | null; invoice: string | null; method: string; amount: string; status: string };

const METHOD: Record<string, string> = { CASH: "نقدي", BANK: "تحويل بنكي", CARD: "بطاقة", CHEQUE: "شيك" };
const fmt = (v: string | null) => Number(v ?? 0).toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (d: Date) => new Date(d).toLocaleDateString("en-GB", { year: "numeric", month: "2-digit", day: "2-digit" });

// Only DRAFT vouchers are selectable — the bulk actions reuse the guarded single-item actions.
export function VouchersTable({ rows, canManage, type }: { rows: VoucherRow[]; canManage: boolean; type: "receipt" | "payment" }) {
  const sel = useSelection();
  const isReceipt = type === "receipt";
  const partyLabel = isReceipt ? "العميل" : "المورد";
  const invoiceBase = isReceipt ? "/sales/invoices" : "/purchases/invoices";
  const printBase = isReceipt ? "/sales/receipts" : "/purchases/payments";
  const bulkAction = isReceipt ? bulkReceiptVouchersAction : bulkPaymentVouchersAction;

  const draftIds = rows.filter((r) => r.status === "DRAFT").map((r) => r.id);
  const showSelect = canManage && draftIds.length > 0;

  return (
    <>
      {showSelect && <BulkBar ids={sel.ids} ops={[{ op: "confirm", label: "تأكيد", icon: "Check" }, { op: "delete", label: "حذف", icon: "Trash2", danger: true }]} action={bulkAction} onDone={sel.clear} entity="سند" />}
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
            <TableHead className="text-start">{partyLabel}</TableHead>
            <TableHead className="text-start">الفاتورة</TableHead>
            <TableHead className="text-start">الطريقة</TableHead>
            <TableHead className="text-start">المبلغ</TableHead>
            <TableHead className="text-start">الحالة</TableHead>
            <TableHead />
            {canManage && <TableHead className="text-start">إجراءات</TableHead>}
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
                <TableCell className="font-mono">{r.number}</TableCell>
                <TableCell>{dt(r.date)}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={r.party ?? undefined}>{r.party ?? "—"}</TableCell>
                <TableCell className="font-mono">{r.invoice ? <Link href={`${invoiceBase}/${encodeURIComponent(r.invoice)}`} className="text-primary hover:underline">{r.invoice}</Link> : "تحت الحساب"}</TableCell>
                <TableCell>{METHOD[r.method] ?? r.method}</TableCell>
                <TableCell>{fmt(r.amount)}</TableCell>
                <TableCell><Badge variant={r.status === "POSTED" ? "default" : r.status === "REVERSED" ? "destructive" : "secondary"}>{r.status === "POSTED" ? "مرحّل" : r.status === "REVERSED" ? "معكوس" : "مسودة"}</Badge></TableCell>
                <TableCell>
                  <Button size="icon" variant="ghost" asChild>
                    <a href={`${printBase}/${encodeURIComponent(r.number)}/print`} target="_blank" rel="noopener" title="طباعة">
                      <Icon name="Printer" className="size-4" />
                    </a>
                  </Button>
                </TableCell>
                {canManage && <TableCell><VoucherRowActions voucherId={r.id} type={type} status={r.status} canManage={canManage} /></TableCell>}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
