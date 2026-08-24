import { describe, it, expect } from "vitest";
import { computeWipeSet, RESET_IDENTITY, RESET_MASTER } from "@/lib/erp/tenant-reset";

// A representative slice of the org-scoped tables (as information_schema would return).
const ALL = [
  ...RESET_IDENTITY, ...RESET_MASTER,
  "accounting_configurations", "document_prefixes", "document_sequences",
  "sales_invoices", "sales_invoice_lines", "journal_entries", "stock_movements",
  "item_balances", "marketplace_settlement_txns", "audit_logs",
  "some_new_operational_table", // a table added later the reset never heard of
];

describe("computeWipeSet", () => {
  it("documents-only keeps identity + settings + master, wipes operational", () => {
    const wipe = new Set(computeWipeSet(ALL, false));
    // identity + master survive
    for (const t of [...RESET_IDENTITY, ...RESET_MASTER, "accounting_configurations", "document_prefixes"]) expect(wipe.has(t)).toBe(false);
    // operational is wiped
    for (const t of ["sales_invoices", "journal_entries", "stock_movements", "item_balances", "audit_logs", "document_sequences"]) expect(wipe.has(t)).toBe(true);
    // a future/unknown table is wiped by default (fail-safe)
    expect(wipe.has("some_new_operational_table")).toBe(true);
  });

  it("full wipe keeps only identity, drops master + settings", () => {
    const wipe = new Set(computeWipeSet(ALL, true));
    for (const t of RESET_IDENTITY) expect(wipe.has(t)).toBe(false); // identity always safe
    for (const t of [...RESET_MASTER, "accounting_configurations", "document_prefixes"]) expect(wipe.has(t)).toBe(true);
  });
});
