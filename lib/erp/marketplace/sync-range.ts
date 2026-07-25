// Pure helper (no DB/server imports) so it stays unit-testable.

export const SYNC_OVERLAP_MS = 10 * 60 * 1000; // re-scan a small window; dedup handles repeats

/** Start of the incremental order window: last sync (minus overlap), else connect time, else 24h ago. */
export function incrementalFrom(lastSyncAt: Date | null, connectedAt: Date | null, now: number, overlapMs = SYNC_OVERLAP_MS): Date {
  const base = lastSyncAt?.getTime() ?? connectedAt?.getTime() ?? now - 24 * 60 * 60 * 1000;
  return new Date(base - overlapMs);
}

/**
 * The earliest PURCHASE date an order may have to be CREATED as a sales order.
 * "created" backfills trust their picked window (`rangeFrom`); every other mode —
 * "updated"/incremental/realtime, which can surface old orders Amazon merely touched
 * — floors at the platform's go-live start date, else the start of today (new orders
 * only). Keeps back-dated orders out of the books; their money closes via settlements.
 */
export function orderCreateFloor(mode: "created" | "updated" | undefined, accountingStartDate: Date | null, rangeFrom: Date, startOfToday: Date): Date {
  if (mode === "created") return rangeFrom;
  return accountingStartDate ?? startOfToday;
}
