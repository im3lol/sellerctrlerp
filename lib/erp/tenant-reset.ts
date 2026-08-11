/**
 * Which org-scoped tables a tenant "reset" wipes vs keeps. Pure + table-driven so it's
 * unit-testable and auditable — the destructive action (app/actions/admin/tenants.ts)
 * enumerates every table carrying `organization_id` from the live schema and subtracts
 * the keep set below, so a NEW operational table is wiped by default (fail-safe: leftover
 * transactions would desync balances) while identity/master stay explicit.
 */

// The company's identity — ALWAYS kept, in every reset mode. (organizations itself has no
// organization_id column, so it never appears in the enumeration and can't be wiped here.)
export const RESET_IDENTITY = [
  "organization_members",
  "org_subscriptions",
  "subscription_requests",
  "subscription_events",
  "subscription_payments",
  "api_keys",
  "platform_credentials", // Amazon/Noon OAuth tokens (cascades away only if its sales_platform is wiped)
] as const;

// Accounting settings + numbering config — kept on a documents-only reset, wiped on a
// full blank-slate reset (then re-seeded by initializeAccountingForOrg).
export const RESET_SETTINGS = ["accounting_configurations", "document_prefixes"] as const;

// Master data (catalog, parties, ledger skeleton, recurring templates) — kept on a
// documents-only reset, wiped on a full reset.
export const RESET_MASTER = [
  "currencies", "exchange_rates", "units_of_measure", "warehouses",
  "item_categories", "items", "item_codes", "item_components",
  "accounts", "accounting_journals", "fiscal_periods", "cost_centers",
  "bank_accounts", "customers", "suppliers", "sales_platforms",
  "investors", "employees", "holidays",
  "recurring_expenses", "recurring_journals", "recurring_journal_lines",
  "recurring_sales_invoices", "recurring_sales_invoice_lines",
] as const;

/** Given every org-scoped table name (from information_schema) and whether the caller
 *  asked to also wipe master data, return the table names to DELETE for this org.
 *  Documents-only keeps settings+master; full wipe keeps only identity. */
export function computeWipeSet(allOrgTables: string[], wipeMaster: boolean): string[] {
  const keep = new Set<string>(
    wipeMaster ? RESET_IDENTITY : [...RESET_IDENTITY, ...RESET_SETTINGS, ...RESET_MASTER],
  );
  return allOrgTables.filter((t) => !keep.has(t));
}
