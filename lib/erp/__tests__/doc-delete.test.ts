import { describe, it, expect } from "vitest";
import { binPurgeVerdict, type BinRow } from "@/lib/erp/doc-delete";

/**
 * Erasing a cancelled document's stock movements is only safe when the ledger can close
 * over the gap. Every movement stores the running balance AFTER it, so removing a pair is
 * safe only if nothing else for the same item+warehouse happened BETWEEN them — otherwise
 * those in-between rows keep balances that still counted this document.
 */
const row = (seq: number, ref: string | null, qty: number, val: number): BinRow => ({
  number: `SM-2026-${String(seq).padStart(4, "0")}`,
  referenceId: ref,
  balanceQuantity: qty,
  balanceValue: val,
});

const DOC = "doc-1";
const OTHER = "doc-2";

describe("binPurgeVerdict", () => {
  it("a contiguous in/out pair that nets to zero is safe", () => {
    // other IN → 10/1000 · ours IN → 20/2000 · ours OUT → 10/1000
    expect(binPurgeVerdict([
      row(1, OTHER, 10, 1000),
      row(2, DOC, 20, 2000),
      row(3, DOC, 10, 1000),
    ], DOC)).toEqual({ kind: "ok" });
  });

  it("safe when the document is the only history (starts from nothing)", () => {
    expect(binPurgeVerdict([row(1, DOC, 10, 1000), row(2, DOC, 0, 0)], DOC)).toEqual({ kind: "ok" });
  });

  it("safe when unrelated movements come AFTER the pair", () => {
    expect(binPurgeVerdict([
      row(1, DOC, 10, 1000),
      row(2, DOC, 0, 0),
      row(3, OTHER, 5, 500),
    ], DOC)).toEqual({ kind: "ok" });
  });

  it("BLOCKS when another document moved the same item between the pair", () => {
    // ours IN → 20 · other OUT → 15 (computed while we still counted) · ours OUT → 5
    expect(binPurgeVerdict([
      row(1, OTHER, 10, 1000),
      row(2, DOC, 20, 2000),
      row(3, OTHER, 15, 1500),
      row(4, DOC, 5, 500),
    ], DOC)).toEqual({ kind: "interleaved", at: "SM-2026-0003" });
  });

  it("BLOCKS when the effect was never fully reversed (quantity left behind)", () => {
    expect(binPurgeVerdict([
      row(1, OTHER, 10, 1000),
      row(2, DOC, 20, 2000),
    ], DOC)).toEqual({ kind: "not-zero" });
  });

  it("BLOCKS when quantity returned but value did not (a stray revaluation)", () => {
    expect(binPurgeVerdict([
      row(1, OTHER, 10, 1000),
      row(2, DOC, 20, 2000),
      row(3, DOC, 10, 1120), // qty back to 10, value 120 too high
    ], DOC)).toEqual({ kind: "not-zero" });
  });

  it("a document that never touched this bin is trivially safe", () => {
    expect(binPurgeVerdict([row(1, OTHER, 10, 1000)], DOC)).toEqual({ kind: "ok" });
  });

  it("orders by the movement sequence, not array order", () => {
    expect(binPurgeVerdict([
      row(4, DOC, 5, 500),
      row(1, OTHER, 10, 1000),
      row(3, OTHER, 15, 1500),
      row(2, DOC, 20, 2000),
    ], DOC)).toEqual({ kind: "interleaved", at: "SM-2026-0003" });
  });
});
