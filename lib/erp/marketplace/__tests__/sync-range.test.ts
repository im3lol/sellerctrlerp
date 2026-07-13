import { describe, it, expect } from "vitest";
import { incrementalFrom, SYNC_OVERLAP_MS } from "../sync-range";

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("incrementalFrom", () => {
  it("uses lastSyncAt minus the overlap when present", () => {
    const last = new Date(NOW - 60_000);
    expect(incrementalFrom(last, new Date(NOW - DAY), NOW).getTime()).toBe(last.getTime() - SYNC_OVERLAP_MS);
  });

  it("falls back to connectedAt when never synced", () => {
    const conn = new Date(NOW - 5 * 60_000);
    expect(incrementalFrom(null, conn, NOW).getTime()).toBe(conn.getTime() - SYNC_OVERLAP_MS);
  });

  it("falls back to 24h ago when neither is set", () => {
    expect(incrementalFrom(null, null, NOW).getTime()).toBe(NOW - DAY - SYNC_OVERLAP_MS);
  });
});
