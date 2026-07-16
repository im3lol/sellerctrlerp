import { describe, it, expect } from "vitest";
import { INVOICE_STATUSES, LIVE_INVOICE_STATUSES, liveInvoice } from "../invoice-status";

/**
 * These pin the two bugs that came from re-typing the status vocabulary per call
 * site: the AR/AP aging pages filtered `status = 'POSTED'` (dropping PARTIAL_PAID
 * and understating receivables), and the VAT report filtered a misspelled
 * 'PARTIALLY_PAID' that matches nothing (under-declaring output VAT).
 */
describe("invoice status vocabulary", () => {
  it("PARTIAL_PAID is spelled the way receipts.ts/payments.ts write it", () => {
    // The VAT report used 'PARTIALLY_PAID' — a value the writers never produce, so
    // the filter silently matched no rows.
    expect(INVOICE_STATUSES).toContain("PARTIAL_PAID");
    expect(INVOICE_STATUSES).not.toContain("PARTIALLY_PAID");
  });

  it("a partly-paid invoice still counts", () => {
    expect(LIVE_INVOICE_STATUSES).toContain("PARTIAL_PAID");
  });

  it("live = every status except DRAFT and CANCELLED", () => {
    const excluded = INVOICE_STATUSES.filter((s) => !LIVE_INVOICE_STATUSES.includes(s));
    expect(excluded).toEqual(["DRAFT", "CANCELLED"]);
  });

  it("the predicate excludes by status rather than listing the live ones", () => {
    // An exclusion means a status added later is counted by default. A list would
    // silently drop it — which is precisely how both bugs happened.
    const { queryChunks } = liveInvoice({ getSQL: () => ({}) } as never) as unknown as { queryChunks: unknown[] };
    const rendered = JSON.stringify(queryChunks);
    expect(rendered).toContain("DRAFT");
    expect(rendered).toContain("CANCELLED");
    expect(rendered).not.toContain("POSTED");
  });
});
