import { describe, it, expect } from "vitest";
import { backoffUntil } from "../backoff";

const at = (min: number) => new Date(Date.UTC(2026, 8, 12, 0, min));
const run = (status: string, min: number) => ({ status, startedAt: at(min) });

describe("backoffUntil", () => {
  it("no history or a success on top means no wait", () => {
    expect(backoffUntil([])).toBeNull();
    expect(backoffUntil([run("OK", 10), run("FAILED", 9)])).toBeNull();
    expect(backoffUntil([run("RUNNING", 10)])).toBeNull();
  });

  it("each consecutive failure waits longer: 1, 5, 30, then 120 minutes", () => {
    expect(backoffUntil([run("FAILED", 10)])).toEqual(at(11));
    expect(backoffUntil([run("FAILED", 10), run("FAILED", 8)])).toEqual(at(15));
    expect(backoffUntil([run("FAILED", 10), run("FAILED", 8), run("FAILED", 6)])).toEqual(at(40));
    expect(backoffUntil([run("FAILED", 10), run("FAILED", 8), run("FAILED", 6), run("FAILED", 4)])).toEqual(at(130));
  });

  it("caps at two hours however long the streak", () => {
    const streak = Array.from({ length: 9 }, (_, i) => run("FAILED", 50 - i));
    expect(backoffUntil(streak)).toEqual(at(170));
  });

  it("only the streak since the last success counts", () => {
    // Failed, then succeeded, then failed again: one failure in a row, not two.
    expect(backoffUntil([run("FAILED", 10), run("OK", 9), run("FAILED", 8)])).toEqual(at(11));
  });
});
