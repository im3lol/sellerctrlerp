import { describe, it, expect } from "vitest";
import { parseMfnReturnsReport } from "@/lib/erp/amazon-mfn-returns";

const tsv = (rows: string[][]) => rows.map((r) => r.join("\t")).join("\n");

describe("seller-fulfilled returns report", () => {
  const header = [
    "Order ID", "Return request date", "Return request status", "Amazon RMA ID", "Is prime",
    "ASIN", "Merchant SKU", "Return quantity", "Return Reason", "Resolution",
    "SafeT claim id", "SafeT claim state", "SafeT claim reimbursement amount",
  ];
  const row = [
    "404-1234567-1234567", "2026-09-05T10:00:00Z", "Approved", "RMA-99", "false",
    "B0DR7P1TKL", "MP-WFZB-N46X", "2", "Item defective", "Standard refund",
    "", "", "",
  ];

  it("reads a return the FBA report would never show", () => {
    const [r] = parseMfnReturnsReport(tsv([header, row]));
    expect(r.orderId).toBe("404-1234567-1234567");
    expect(r.sku).toBe("MP-WFZB-N46X");
    expect(r.asin).toBe("B0DR7P1TKL");
    expect(r.quantity).toBe(2);
    expect(r.reason).toBe("Item defective");
    expect(r.returnDate?.toISOString().slice(0, 10)).toBe("2026-09-05");
  });

  it("leaves the disposition blank rather than guessing one", () => {
    // A seller-fulfilled report states a resolution, not a warehouse condition. Anything
    // not explicitly SELLABLE is treated as unsellable downstream, and the trader picks
    // the real condition on receipt — so guessing here would quietly restock damage.
    expect(parseMfnReturnsReport(tsv([header, row]))[0].disposition).toBe("");
  });

  it("matches column names however Amazon spells them", () => {
    const alt = ["order-id", "return-date", "status", "rma-id", "is-prime", "asin", "sku", "quantity", "reason", "resolution", "safet-claim-id", "safet-claim-state", "safet-claim-reimbursement-amount"];
    const [r] = parseMfnReturnsReport(tsv([alt, row]));
    expect(r.sku).toBe("MP-WFZB-N46X");
    expect(r.quantity).toBe(2);
  });

  it("carries the SAFE-T claim so it can be tracked to its outcome", () => {
    const claimed = [...row];
    claimed[10] = "SAFET-123"; claimed[11] = "Granted"; claimed[12] = "1,250.50";
    const [r] = parseMfnReturnsReport(tsv([header, claimed]));
    expect(r.safetClaimId).toBe("SAFET-123");
    expect(r.safetClaimState).toBe("Granted");
    expect(r.safetReimbursement).toBe(1250.5);
  });

  it("treats a missing quantity as one unit, not zero", () => {
    const noQty = [...row];
    noQty[7] = "";
    expect(parseMfnReturnsReport(tsv([header, noQty]))[0].quantity).toBe(1);
  });

  it("returns NOTHING for a header it does not recognise", () => {
    // The account this was built against sells FBA only, so the real header could not be
    // checked against a live report. A silent zero is recoverable; invented returns that
    // reverse invoices and move stock are not.
    expect(parseMfnReturnsReport(tsv([["something", "else", "entirely"], ["a", "b", "c"]]))).toEqual([]);
    expect(parseMfnReturnsReport("")).toEqual([]);
  });

  it("skips a row with no order or no sku", () => {
    const blank = [...row];
    blank[0] = "";
    expect(parseMfnReturnsReport(tsv([header, blank]))).toEqual([]);
  });
});
