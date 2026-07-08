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
