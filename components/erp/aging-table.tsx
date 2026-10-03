import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/lib/i18n/server";
import { AGING_BUCKETS, BUCKET_LABELS, type AgingBucket, type AgingRow } from "@/lib/erp/aging";

const fmt = (n: number) => (n ? n.toLocaleString("ar-EG-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");

export async function AgingTable({
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
  const t = await getT();
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
          <TableHead className="text-start">{t("الإجمالي")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.partyId}>
            <TableCell className="max-w-[260px] whitespace-normal">
              <div className="line-clamp-2 leading-snug" title={r.partyName}><span className="font-mono text-muted-foreground">{r.partyCode}</span> {r.partyName}</div>
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
          <TableCell>{t("الإجمالي")}</TableCell>
          {AGING_BUCKETS.map((b) => (
            <TableCell key={b}>{fmt(totals[b])}</TableCell>
          ))}
          <TableCell>{fmt(grand)}</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}
