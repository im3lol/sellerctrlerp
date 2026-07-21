import { describe, it, expect } from "vitest";
import { nextDocumentNumber } from "@/lib/erp/sequence";

/**
 * The number generator must reject an Invalid Date (year = NaN) or an
 * out-of-range year BEFORE touching the DB, so no document action can mint a
 * malformed number or blow up on the integer column with a cryptic error.
 * A throwing fake exec proves the guard short-circuits ahead of any query.
 */
const explodingExec = {
  execute: () => {
    throw new Error("DB should not be reached for an invalid year");
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("nextDocumentNumber year guard", () => {
  it("rejects NaN year (Invalid Date)", async () => {
    await expect(nextDocumentNumber(explodingExec, "org", "SI", new Date("garbage").getFullYear()))
      .rejects.toThrow("تاريخ المستند غير صالح");
  });

  it("rejects out-of-range years", async () => {
    await expect(nextDocumentNumber(explodingExec, "org", "SI", 1800)).rejects.toThrow("تاريخ المستند غير صالح");
    await expect(nextDocumentNumber(explodingExec, "org", "SI", 12345)).rejects.toThrow("تاريخ المستند غير صالح");
  });

  it("rejects non-integer year", async () => {
    await expect(nextDocumentNumber(explodingExec, "org", "SI", 2024.5)).rejects.toThrow("تاريخ المستند غير صالح");
  });
});

/**
 * SaaS invariant: an org with NO prefix override gets numbers byte-identical to
 * before per-org prefixes existed — the resolved prefix equals the passed key,
 * and the sequence counter is keyed by that same prefix. A stub exec whose
 * override lookup returns [] proves the fallback path.
 */
describe("nextDocumentNumber prefix override", () => {
  const stubExec = (override: string | null) => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (override ? [{ prefix: override }] : []) }) }) }),
    execute: async () => ({ rows: [{ current_value: 7 }] }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  it("no override → prefix === key (unchanged)", async () => {
    expect(await nextDocumentNumber(stubExec(null), "org", "SI", 2026)).toBe("SI-2026-0007");
  });

  it("override → uses the org's custom prefix", async () => {
    expect(await nextDocumentNumber(stubExec("INV"), "org", "SI", 2026)).toBe("INV-2026-0007");
  });
});
