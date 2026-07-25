import { describe, it, expect } from "vitest";
import { incrementalFrom, SYNC_OVERLAP_MS, orderCreateFloor } from "../sync-range";

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

describe("orderCreateFloor", () => {
  const goLive = new Date("2026-07-01");
  const today = new Date("2026-07-25");
  const window = new Date("2026-06-01"); // an explicit backfill window start

  it("trusts the picked window in created mode (explicit backfill)", () => {
    expect(orderCreateFloor("created", goLive, window, today)).toBe(window);
  });

  it("floors updated/incremental mode at the go-live start date", () => {
    // an old order Amazon just touched must not be created — floor is go-live, not the fetch window
    expect(orderCreateFloor("updated", goLive, window, today)).toBe(goLive);
    expect(orderCreateFloor(undefined, goLive, window, today)).toBe(goLive);
  });

  it("floors at start of today when no go-live date is set (new orders only)", () => {
    expect(orderCreateFloor("updated", null, window, today)).toBe(today);
  });
});
