// Pure helper (no DB/server imports) so it stays unit-testable.

export const SYNC_OVERLAP_MS = 10 * 60 * 1000; // re-scan a small window; dedup handles repeats

/** Start of the incremental order window: last sync (minus overlap), else connect time, else 24h ago. */
export function incrementalFrom(lastSyncAt: Date | null, connectedAt: Date | null, now: number, overlapMs = SYNC_OVERLAP_MS): Date {
  const base = lastSyncAt?.getTime() ?? connectedAt?.getTime() ?? now - 24 * 60 * 60 * 1000;
  return new Date(base - overlapMs);
}
