import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AGING_BUCKETS, BUCKET_LABELS, type AgingBucket, type AgingRow } from "@/lib/erp/aging";

const fmt = (n: number) => (n ? n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

export function AgingTable({
  rows,
  totals,
  grand,
  partyLabel,
  empty,
}: {
  rows: AgingRow[];
  totals: Record<AgingBucket, number>;
  grand: number;
  partyLabel: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed py-12 text-center text-muted-foreground">{empty}</div>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-start">{partyLabel}</TableHead>
          {AGING_BUCKETS.map((b) => (
            <TableHead key={b} className="text-start">{BUCKET_LABELS[b]}</TableHead>
          ))}
          <TableHead className="text-start">الإجمالي</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.partyId}>
            <TableCell>
              <span className="font-mono text-muted-foreground">{r.partyCode}</span> {r.partyName}
            </TableCell>
            {AGING_BUCKETS.map((b) => (
              <TableCell key={b}>{fmt(r.buckets[b])}</TableCell>
            ))}
            <TableCell className="font-semibold">{fmt(r.total)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
      <TableFooter>
        <TableRow className="font-bold">
          <TableCell>الإجمالي</TableCell>
          {AGING_BUCKETS.map((b) => (
            <TableCell key={b}>{fmt(totals[b])}</TableCell>
          ))}
          <TableCell>{fmt(grand)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
