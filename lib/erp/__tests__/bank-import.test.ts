import { describe, it, expect } from "vitest";
import { parseAmount, parseBankDate, parseBankRows, lineKey, matchPayouts } from "@/lib/erp/bank-import";

const day = (s: string) => new Date(`${s}T00:00:00Z`);

describe("parseAmount", () => {
  it("reads the ways banks print money", () => {
    expect(parseAmount("1,234.50")).toBe(1234.5);
    expect(parseAmount("(1,234.50)")).toBe(-1234.5);
    expect(parseAmount("250.00-")).toBe(-250);
    expect(parseAmount("١٬٢٣٤٫٥٠")).toBe(1234.5);
    expect(parseAmount("EGP 50")).toBe(50);
    expect(parseAmount(75)).toBe(75);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("رصيد")).toBeNull();
  });
});

describe("parseBankDate", () => {
  it("is day-first, like Egyptian statements", () => {
    expect(parseBankDate("12/09/2026")).toEqual(day("2026-09-12"));
    expect(parseBankDate("03-09-26")).toEqual(day("2026-09-03"));
  });
  it("switches to month-first only when the day can't be a month", () => {
    expect(parseBankDate("09/25/2026")).toEqual(day("2026-09-25"));
  });
  it("takes ISO text, spreadsheet dates and month names", () => {
    expect(parseBankDate("2026-09-12")).toEqual(day("2026-09-12"));
    expect(parseBankDate(new Date(2026, 8, 12))).toEqual(day("2026-09-12"));
    expect(parseBankDate("12 Sep 2026")).toEqual(day("2026-09-12"));
  });
  it("refuses what isn't a date", () => {
    expect(parseBankDate("31/02/2026")).toBeNull();
    expect(parseBankDate("الإجمالي")).toBeNull();
    expect(parseBankDate("1234")).toBeNull();
  });
});

describe("parseBankRows", () => {
  it("finds the header under the bank's preamble and reads Credit as money IN", () => {
    const r = parseBankRows([
      ["Account statement"],
      ["Account", "1001-22"],
      ["Date", "Description", "Reference", "Debit", "Credit", "Balance"],
      ["01/09/2026", "Opening balance", "", "", "", "10,000.00"],
      ["05/09/2026", "AMAZON PAYMENTS", "TRX1", "", "4,277.76", "14,277.76"],
      ["06/09/2026", "Bank fee", "", "25.00", "", "14,252.76"],
      ["", "Total", "", "25.00", "4,277.76", ""],
    ]);
    expect(r.mapping).not.toBeNull();
    expect(r.lines).toEqual([
      { date: day("2026-09-05"), description: "AMAZON PAYMENTS", reference: "TRX1", moneyIn: 4277.76, moneyOut: 0 },
      { date: day("2026-09-06"), description: "Bank fee", reference: "", moneyIn: 0, moneyOut: 25 },
    ]);
    expect(r.skipped).toBe(2); // opening balance + totals
  });

  it("reads Arabic headers", () => {
    const r = parseBankRows([
      ["التاريخ", "البيان", "مدين", "دائن"],
      ["10/09/2026", "إيداع أمازون", "", "5,299.03"],
      ["11/09/2026", "سحب نقدي", "1,000", ""],
    ]);
    expect(r.lines.map((l) => [l.moneyIn, l.moneyOut])).toEqual([[5299.03, 0], [0, 1000]]);
  });

  it("splits a single signed amount column by its sign", () => {
    const r = parseBankRows([
      ["Date", "Details", "Amount"],
      ["2026-09-12", "Payout", "7,804.54"],
      ["2026-09-12", "Transfer out", "-300"],
    ]);
    expect(r.lines.map((l) => [l.moneyIn, l.moneyOut])).toEqual([[7804.54, 0], [0, 300]]);
  });

  it("says so when there is no date or money column", () => {
    expect(parseBankRows([["name", "note"], ["x", "y"]]).mapping).toBeNull();
  });

  it("gives identical lines the same key", () => {
    const [a] = parseBankRows([["Date", "Amount"], ["12/09/2026", "10"]]).lines;
    const [b] = parseBankRows([["التاريخ", "المبلغ"], ["2026-09-12", "10.00"]]).lines;
    expect(lineKey(a)).toBe(lineKey(b));
  });
});

describe("matchPayouts", () => {
  const payouts = [
    { id: "p1", amount: 4277.76, date: day("2026-09-11") },
    { id: "p2", amount: 5299.03, date: day("2026-09-10") },
    { id: "p3", amount: 100, date: day("2026-09-01") },
  ];
  it("pairs each payout with the same-amount deposit nearest in date", () => {
    const m = matchPayouts(payouts, [
      { id: "d-far", date: day("2026-09-17"), moneyIn: 4277.76 },
      { id: "d-near", date: day("2026-09-13"), moneyIn: 4277.76 },
      { id: "d2", date: day("2026-09-12"), moneyIn: 5299.5 },
    ]);
    expect(m.get("p1")?.id).toBe("d-near");
    expect(m.get("p2")?.id).toBe("d2"); // within ±1 for rounding
    expect(m.has("p3")).toBe(false);
  });
  it("uses a deposit once, and not outside the window", () => {
    const m = matchPayouts(
      [{ id: "a", amount: 50, date: day("2026-09-01") }, { id: "b", amount: 50, date: day("2026-09-02") }],
      [{ id: "d", date: day("2026-09-02"), moneyIn: 50 }, { id: "late", date: day("2026-09-20"), moneyIn: 50 }],
    );
    expect([...m.values()].map((d) => d.id)).toEqual(["d"]);
  });
});
