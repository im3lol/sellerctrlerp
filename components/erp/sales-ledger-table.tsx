"use client";

import Link from "next/link";
import type { SalesLedgerRow, SalesLedgerTotals } from "@/lib/erp/sales-ledger";

const LOC = "ar-EG-u-nu-latn";
const fmtMoney = (n: number) =>
  n.toLocaleString(LOC, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (n: number) =>
  n.toLocaleString(LOC, { maximumFractionDigits: 2 });
const fmtDate = (d: Date) =>
  new Date(d).toLocaleDateString(LOC, { year: "numeric", month: "2-digit", day: "2-digit" });

const DOC = {
  ORDER:    { label: "أمر بيع",    cls: "bg-blue-50 text-blue-700 border-blue-200" },
  DELIVERY: { label: "إذن صرف",    cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  INVOICE:  { label: "فاتورة بيع", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  RETURN:   { label: "مرتجع",      cls: "bg-destructive/10 text-destructive border-destructive/20" },
} as const;

const STATUS: Record<string, string> = {
  DRAFT: "مسودة", CONFIRMED: "مؤكّد", DELIVERED: "مُسلّم", PARTIALLY_DELIVERED: "مُسلّم جزئياً",
  INVOICED: "مُفوتر", POSTED: "مُرحَّل", PARTIAL_PAID: "مدفوعة جزئياً",
  PAID: "مدفوعة", CANCELLED: "ملغاة",
};

function MoneyCell({ v }: { v: number | null }) {
  return v !== null ? (
    <span className="tabular-nums">{fmtMoney(v)}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

function QtyCell({ v, strong }: { v: number | null; strong?: boolean }) {
  return v !== null ? (
    <span className={`tabular-nums${strong ? " font-medium" : ""}`}>{fmtQty(v)}</span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

export function SalesLedgerTable({
  rows,
  totals,
}: {
  rows: SalesLedgerRow[];
  totals: SalesLedgerTotals;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm" dir="rtl">
        <thead className="bg-muted/50 text-muted-foreground text-xs">
          <tr>
            <th className="px-3 py-2 text-right font-medium">الرقم</th>
            <th className="px-3 py-2 text-right font-medium">التاريخ</th>
            <th className="px-3 py-2 text-right font-medium">العميل</th>
            <th className="px-3 py-2 text-right font-medium">النوع</th>
            <th className="px-3 py-2 text-right font-medium">الحالة</th>
            <th className="px-3 py-2 text-left font-medium">الكلي</th>
            <th className="px-3 py-2 text-left font-medium">المُسلّم</th>
            <th className="px-3 py-2 text-left font-medium">السعر</th>
            <th className="px-3 py-2 text-left font-medium">الخصم</th>
            <th className="px-3 py-2 text-left font-medium">الضريبة</th>
            <th className="px-3 py-2 text-left font-medium">الإجمالي</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const doc = DOC[r.docType];
            return (
              <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2">
                  <Link href={r.href} className="font-mono text-xs hover:text-primary">
                    {r.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                  {fmtDate(r.date)}
                </td>
                <td className="px-3 py-2 max-w-[140px] truncate" title={r.customerName}>
                  {r.customerName}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${doc.cls}`}>
                    {doc.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">
                  {STATUS[r.status] ?? r.status}
                </td>
                <td className="px-3 py-2 text-left"><QtyCell v={r.qtyTotal} strong /></td>
                <td className="px-3 py-2 text-left text-emerald-700"><QtyCell v={r.qtyDelivered} /></td>
                <td className="px-3 py-2 text-left"><MoneyCell v={r.subtotal} /></td>
                <td className="px-3 py-2 text-left"><MoneyCell v={r.discount} /></td>
                <td className="px-3 py-2 text-left"><MoneyCell v={r.tax} /></td>
                <td className="px-3 py-2 text-left font-medium"><MoneyCell v={r.total} /></td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="border-t-2 border-border bg-muted/40">
          <tr className="font-semibold text-sm">
            <td colSpan={5} className="px-3 py-2.5 text-right text-muted-foreground">
              الإجمالي الكلي
            </td>
            <td className="px-3 py-2.5 text-left tabular-nums">{fmtQty(totals.qtyTotal)}</td>
            <td className="px-3 py-2.5 text-left tabular-nums text-emerald-700">{fmtQty(totals.qtyDelivered)}</td>
            <td className="px-3 py-2.5 text-left tabular-nums">{fmtMoney(totals.subtotal)}</td>
            <td className="px-3 py-2.5 text-left tabular-nums">{fmtMoney(totals.discount)}</td>
            <td className="px-3 py-2.5 text-left tabular-nums">{fmtMoney(totals.tax)}</td>
            <td className="px-3 py-2.5 text-left tabular-nums">{fmtMoney(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
