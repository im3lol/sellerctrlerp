import { describe, it, expect } from "vitest";
import { buildDisposalLines, type DisposalAccounts } from "../asset-disposal";

const ACC: DisposalAccounts = { asset: "A", accumDeprec: "D", proceeds: "C", gain: "G", loss: "L" };
const sum = (ls: { debit: number; credit: number }[]) => ({
  debit: ls.reduce((s, l) => s + l.debit, 0),
  credit: ls.reduce((s, l) => s + l.credit, 0),
});
const on = (ls: { accountId: string; debit: number; credit: number }[], id: string) =>
  ls.find((l) => l.accountId === id);

describe("buildDisposalLines", () => {
  it("books the gain when an asset sells above book value", () => {
    // The audit's scenario: cost 50k, 30k depreciated (NBV 20k), sold for 25k.
    // This used to post nothing at all — the asset stayed on the balance sheet at
    // 20k forever and the 25k of cash never entered the ledger.
    const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 30_000, proceeds: 25_000, assetName: "آلة", accounts: ACC });
    expect(on(lines, "C")).toMatchObject({ debit: 25_000, credit: 0 });
    expect(on(lines, "D")).toMatchObject({ debit: 30_000, credit: 0 });
    expect(on(lines, "A")).toMatchObject({ debit: 0, credit: 50_000 });
    expect(on(lines, "G")).toMatchObject({ debit: 0, credit: 5_000 });
    expect(on(lines, "L")).toBeUndefined();
    expect(sum(lines)).toEqual({ debit: 55_000, credit: 55_000 });
  });

  it("books the loss when an asset sells below book value", () => {
    // Same asset (NBV 20k) sold for 12k → 8k loss.
    const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 30_000, proceeds: 12_000, assetName: "آلة", accounts: ACC });
    expect(on(lines, "L")).toMatchObject({ debit: 8_000, credit: 0 });
    expect(on(lines, "G")).toBeUndefined();
    expect(sum(lines)).toEqual({ debit: 50_000, credit: 50_000 });
  });

  it("scrapping for nothing writes the whole book value off as a loss", () => {
    const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 30_000, proceeds: 0, assetName: "آلة", accounts: ACC });
    expect(on(lines, "C")).toBeUndefined(); // no proceeds line
    expect(on(lines, "L")).toMatchObject({ debit: 20_000, credit: 0 });
    expect(sum(lines)).toEqual({ debit: 50_000, credit: 50_000 });
  });

  it("a fully-depreciated asset scrapped for nothing nets to a clean close-out", () => {
    // NBV 0, no gain or loss — postEntry rejects zero-value lines, so none is emitted.
    const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 50_000, proceeds: 0, assetName: "آلة", accounts: ACC });
    expect(lines).toHaveLength(2);
    expect(sum(lines)).toEqual({ debit: 50_000, credit: 50_000 });
    expect(lines.every((l) => l.debit > 0 || l.credit > 0)).toBe(true);
  });

  it("a fully-depreciated asset sold for cash is all gain", () => {
    const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 50_000, proceeds: 3_000, assetName: "آلة", accounts: ACC });
    expect(on(lines, "G")).toMatchObject({ debit: 0, credit: 3_000 });
    expect(sum(lines)).toEqual({ debit: 53_000, credit: 53_000 });
  });

  it("balances across the gain/loss boundary at any proceeds", () => {
    // The property that matters: postEntry throws unless debits equal credits, so a
    // disposal that cannot balance is a disposal nobody can record.
    for (const proceeds of [0, 1, 19_999.99, 20_000, 20_000.01, 33_333.33, 100_000]) {
      const lines = buildDisposalLines({ cost: 50_000, accumulatedDepreciation: 30_000, proceeds, assetName: "آلة", accounts: ACC });
      const { debit, credit } = sum(lines);
      expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    }
  });

  it("omits the proceeds line when no cash account was given", () => {
    const lines = buildDisposalLines({ cost: 100, accumulatedDepreciation: 100, proceeds: 0, assetName: "x", accounts: { ...ACC, proceeds: undefined } });
    expect(on(lines, "C")).toBeUndefined();
    expect(sum(lines)).toEqual({ debit: 100, credit: 100 });
  });
});
