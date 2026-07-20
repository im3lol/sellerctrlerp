import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Shared rendering for the FBA Inventory Audit — used by the full reconciliation
// screen and the compact card on the platform page. Read-only: display only.

const int = (n: number | string) => Number(n ?? 0).toLocaleString("ar-EG-u-nu-latn");
const qty = (n: number | string) => Number(n ?? 0).toLocaleString("ar-EG-u-nu-latn", { maximumFractionDigits: 3 });

/** Status → Arabic label + tone. Temporary states amber; real losses red. */
export const AUDIT_STATUS: Record<string, { label: string; cls: string }> = {
  MATCHED: { label: "مطابق", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  RECEIVING: { label: "قيد الاستلام", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  RESEARCHING: { label: "قيد البحث", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  FOUND: { label: "زيادة", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  DAMAGED: { label: "تالف", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  LOST: { label: "مفقود", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
  UNMATCHED: { label: "غير مربوط", cls: "bg-muted text-muted-foreground" },
};

export type AuditLine = {
  id: string; code: string; asin: string | null; itemName: string | null;
  erpQty: string; amazonTotal: number; available: number; reserved: number; inbound: number;
  damaged: number; researching: number; diff: string; status: string;
};
export type AuditHeader = { totalSkus: number; matched: number; unmatched: number; withDiff: number; lost: number; damaged: number };

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" | "ok" }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${tone === "danger" ? "text-destructive" : tone === "ok" ? "text-emerald-600" : ""}`}>{value}</div>
    </div>
  );
}

/** The six summary stats. */
export function AuditStats({ audit }: { audit: AuditHeader }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Stat label="إجمالي الأصناف" value={int(audit.totalSkus)} />
      <Stat label="مطابَقة بأصناف" value={int(audit.matched)} />
      <Stat label="غير مربوطة" value={int(audit.unmatched)} tone={audit.unmatched > 0 ? "danger" : undefined} />
      <Stat label="بها فروق" value={int(audit.withDiff)} tone={audit.withDiff > 0 ? "danger" : undefined} />
      <Stat label="مفقود" value={int(audit.lost)} tone={audit.lost > 0 ? "danger" : undefined} />
      <Stat label="تالف" value={int(audit.damaged)} tone={audit.damaged > 0 ? "danger" : undefined} />
    </div>
  );
}

/** The audit lines table (rows are pre-sorted by the caller: problems first). */
export function AuditLinesTable({ rows }: { rows: AuditLine[] }) {
  return (
    <Table>
      <TableHeader className="sticky top-0 bg-background">
        <TableRow>
          <TableHead className="text-start min-w-[220px]">الصنف</TableHead>
          <TableHead className="text-start">النظام</TableHead>
          <TableHead className="text-start">أمازون</TableHead>
          <TableHead className="text-start">متاح</TableHead>
          <TableHead className="text-start">محجوز</TableHead>
          <TableHead className="text-start">استلام</TableHead>
          <TableHead className="text-start">تالف</TableHead>
          <TableHead className="text-start">الفرق</TableHead>
          <TableHead className="text-start">الحالة</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((l) => {
          const s = AUDIT_STATUS[l.status] ?? { label: l.status, cls: "bg-muted" };
          const diff = Number(l.diff);
          return (
            <TableRow key={l.id}>
              <TableCell className="min-w-[220px] max-w-[380px] whitespace-normal align-top">
                <div className="font-mono text-xs text-muted-foreground" dir="ltr">{l.code}</div>
                {l.asin && <div className="font-mono text-[10px] text-muted-foreground" dir="ltr">ASIN: {l.asin}</div>}
                {l.itemName && <div className="line-clamp-2 text-sm">{l.itemName}</div>}
              </TableCell>
              <TableCell className="tabular-nums">{qty(l.erpQty)}</TableCell>
              <TableCell className="tabular-nums font-medium">{int(l.amazonTotal)}</TableCell>
              <TableCell className="tabular-nums">{int(l.available)}</TableCell>
              <TableCell className="tabular-nums">{int(l.reserved)}</TableCell>
              <TableCell className="tabular-nums">{int(l.inbound)}</TableCell>
              <TableCell className={`tabular-nums ${l.damaged > 0 ? "text-destructive" : ""}`}>{int(l.damaged)}</TableCell>
              <TableCell className={`tabular-nums font-medium ${diff !== 0 ? "text-destructive" : "text-muted-foreground"}`}>{diff > 0 ? "+" : ""}{qty(diff)}</TableCell>
              <TableCell><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span></TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
