export type AgingBucket = "current" | "d30" | "d60" | "d90" | "d90plus";

export const AGING_BUCKETS: AgingBucket[] = ["current", "d30", "d60", "d90", "d90plus"];

export const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: "غير مستحق",
  d30: "1 – 30 يوم",
  d60: "31 – 60 يوم",
  d90: "61 – 90 يوم",
  d90plus: "أكثر من 90 يوم",
};

const DAY = 86_400_000;

/** Classify an open document into an aging bucket relative to `asOf`. */
export function bucketOf(dueDate: Date | null, fallbackDate: Date, asOf: Date): AgingBucket {
  const ref = dueDate ?? fallbackDate;
  const days = Math.floor((asOf.getTime() - new Date(ref).getTime()) / DAY);
  if (days <= 0) return "current";
  if (days <= 30) return "d30";
  if (days <= 60) return "d60";
  if (days <= 90) return "d90";
  return "d90plus";
}

export type AgingRow = {
  partyId: string;
  partyCode: string;
  partyName: string;
  buckets: Record<AgingBucket, number>;
  total: number;
};

export type OpenDoc = {
  partyId: string;
  partyCode: string;
  partyName: string;
  date: Date;
  dueDate: Date | null;
  balanceDue: number;
};

/** Aggregate open documents into per-party aging rows + column totals. */
export function buildAging(docs: OpenDoc[], asOf: Date): { rows: AgingRow[]; totals: Record<AgingBucket, number>; grand: number } {
  const byParty = new Map<string, AgingRow>();
  const zero = (): Record<AgingBucket, number> => ({ current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 });
  const totals = zero();

  for (const d of docs) {
    if (d.balanceDue <= 0) continue;
    let row = byParty.get(d.partyId);
    if (!row) {
      row = { partyId: d.partyId, partyCode: d.partyCode, partyName: d.partyName, buckets: zero(), total: 0 };
      byParty.set(d.partyId, row);
    }
    const b = bucketOf(d.dueDate, d.date, asOf);
    row.buckets[b] += d.balanceDue;
    row.total += d.balanceDue;
    totals[b] += d.balanceDue;
  }

  const rows = [...byParty.values()].sort((a, b) => b.total - a.total);
  const grand = AGING_BUCKETS.reduce((s, b) => s + totals[b], 0);
  return { rows, totals, grand };
}
