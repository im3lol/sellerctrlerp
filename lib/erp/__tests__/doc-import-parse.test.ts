import { describe, it, expect } from "vitest";
import { prep, groupByRef, parseDate, nz } from "@/lib/erp/doc-import-parse";

describe("doc-import parse/group", () => {
  const csv = `ref,date,customer,item,quantity,unitPrice
A1,2026-07-12,C001,ITM001,10,250
A1,2026-07-12,C001,ITM002,5,100
A2,2026-07-13,C002,ITM001,3,250`;

  it("maps columns by (despaced/lowercased) header name", () => {
    const p = prep(csv)!;
    expect(p).not.toBeNull();
    expect(p.dataRows).toHaveLength(3);
    expect(p.col(p.dataRows[0], ["customer", "العميل"])).toBe("C001");
    expect(p.col(p.dataRows[0], ["unitprice", "السعر"])).toBe("250"); // "unitPrice" header → "unitprice"
    expect(p.col(p.dataRows[0], ["missing"])).toBe(""); // unknown column → empty, not a throw
  });

  it("groups rows by ref preserving order; same ref = one document", () => {
    const p = prep(csv)!;
    const groups = groupByRef(p.dataRows, (r) => p.col(r, ["ref"]));
    expect(groups.map((g) => g.ref)).toEqual(["A1", "A2"]);
    expect(groups[0].rows).toHaveLength(2); // A1 has two lines
    expect(groups[1].rows).toHaveLength(1);
  });

  it("returns null for header-only / empty input (nothing to import)", () => {
    expect(prep("ref,date,customer\n")).toBeNull();
    expect(prep("")).toBeNull();
  });

  it("gives a stable synthetic ref when the ref cell is blank", () => {
    const p = prep(`ref,item,quantity\n,ITM001,2\n,ITM002,3`)!;
    const groups = groupByRef(p.dataRows, (r) => p.col(r, ["ref"]));
    // blank refs must NOT collapse into one doc — each blank row is its own document
    expect(groups).toHaveLength(2);
    expect(groups[0].ref).toBe("#1");
    expect(groups[1].ref).toBe("#2");
  });

  it("nz coerces numbers and defaults non-numbers to 0; parseDate falls back to now", () => {
    expect(nz("250")).toBe(250);
    expect(nz("")).toBe(0);
    expect(nz("abc")).toBe(0);
    expect(parseDate("2026-07-12").getFullYear()).toBe(2026);
    expect(Number.isNaN(parseDate("not-a-date").getTime())).toBe(false); // fallback to a valid date
  });
});
