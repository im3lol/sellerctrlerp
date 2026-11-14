# Returns resolution workflow

The existing `/sales/marketplace-returns` workspace tracks Amazon refunds, physical
receipts, removals, fees, losses and reimbursements independently. Other marketplace
returns keep their existing workspace. Source capture never posts money or stock.

## Rollout

Migration `0157` adds four organization-scoped tables and nullable source/component
metadata. Existing invoice refunds default to zero; no historical amounts are changed.
With no settings row the workflow is disabled. Enable **MONITOR** for the pilot:
observations, matches, claim tracking and exceptions are allowed; document posting is
blocked server-side. The pilot is observation only, without historical reconciliation.

**MANUAL** requires an authorized manager's acknowledgment and records a cutover.
Only separately reviewed current evidence can be posted. Once a cutover exists,
return to MONITOR to stop posting; DISABLED is refused so the legacy writer cannot
resume. Review historical draft documents separately; do not bulk-confirm them.

## Decisions and accounting

- Match the original account, order and invoice lines. Unknown quantities remain
  unknown; they are never silently set to one.
- Approve the financial credit separately from payout. Principal, discounts, tax and
  shipping are stored separately. Credit reduces customer receivables; a released
  payout clears that credit, records actual wallet/fee effects and preserves original
  gross collections. `balance_due = total - paid - credits + refunded`.
- A local receiving note or matched FBA source proves stock receipt. A refund does
  not. Restock at the original issue cost, or place unsellable units in quarantine.
  Explicit write-off reclassifies their cost to loss without restocking.
- Removal dispatch moves stock from FBA to a separate transit warehouse. Receive
  partial shipments into the destination, or explicitly approve a transit loss.
  Removal reports include available carrier/tracking details; carrier delivery alone
  never proves the warehouse's accepted quantity. Expand the sync date range for
  older removal requests; source reports can arrive late.
- Record automatic or submitted claims, their references and expected outcomes.
  Rejected claims remain unresolved until an authorized documented closure.
- Link cash reimbursement to its already posted settlement movement; do not create
  the same income twice. Inventory reimbursement requires actual positive inventory
  evidence and the original sale/loss cost. Partial outcomes remain open.
- Reverse approved decisions in dependency order. Mirror entries/movements preserve
  the original history; consumed inventory or changed valuation requires an explicit
  correction review rather than silently rewriting a cost.

## Evidence, permissions and boundaries

Raw source revisions and operation receipts are immutable. Internal approval never
overwrites an Amazon receipt/disposition. Same-account evidence can be explicitly
linked with a reason, without moving or rewriting the source. Concurrency uses case
versions, database row/advisory locks, idempotency keys and one atomic transaction
including the audit row. PostgreSQL enforces tenant RLS and composite case ownership.

The case state is a versioned JSON aggregate; immutable event and operation tables
hold the evidence and document references. This keeps a decision atomic without
duplicating the existing stock, credit-note, transfer and journal document engines.

Ambiguous legacy account assignments are held for review, not guessed. Partial
returns from several old lots with no reliable individual cost snapshot, mixed expiry
lots, serial-tracked items and partial original costs below currency-cent precision are
held for a separate allocation review. Posting to a
closed period, missing FX rates, component rounding differences and already processed
legacy sources are refused. These holds are intentional; they are not completed
reconciliations. No historical settlement rewrite, external refund issuance or automatic
Amazon claim submission is performed.

## Validation

`npm test` covers fixed-scale refund arithmetic and independent closure. Opt-in real
PostgreSQL tests require `RETURNS_TEST_DATABASE_URL`, and refuse any database whose
name is not `sellerctrl_returns_test`. Run them only against an empty schema fixture.
They cover monitoring, rollback after actual financial posting, concurrent retries,
version conflicts, tenant RLS, immutability, credit/payout/stock separation, receipt
reversal, partial transit/loss, and matching reimbursement without duplicate income.
CI builds that database independently of its accounting-engine fixtures.

Official report semantics:
[FBA returns, reimbursements and removals](https://developer-docs.amazon/sp-api/docs/report-type-values-fba),
[seller-fulfilled returns](https://developer-docs.amazon/sp-api/docs/report-type-values-returns),
[Finances transactions](https://developer-docs.amazon/sp-api/docs/finances-api-v2024-06-19-reference).
