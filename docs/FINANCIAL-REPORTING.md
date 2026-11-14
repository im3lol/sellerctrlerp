# Financial reporting controls

## Document lifecycle ledgers

Orders, deliveries/receipts and invoices are stages of the same transaction. Their
amounts and quantities must never be summed as independent sales or purchases.

`lib/erp/document-ledger-totals.ts` defines the shared footer contract:

- With all document types selected, financial amounts and invoiced quantities come
  from POSTED/PARTIAL_PAID/PAID invoices, less POSTED invoice credit/debit notes.
- Stock-only returns have no financial amounts in these ledgers. Their quantities
  reduce the delivery/receipt column, not invoiced quantities.
- Delivery and receipt columns describe stock documents in the selected period;
  they are separate measures from invoiced quantities. They need not match when
  delivery and invoicing happen in different periods.
- An explicit document-type filter shows approved activity for that stage. Draft,
  cancelled and reversed documents remain available for traceability but contribute
  no recognized totals. Return amounts in the footer are deductions.
- Product search selects documents containing a matching item. It does not turn
  document header amounts into item-only amounts; the UI states this explicitly.
- Money is accumulated as integer cents; quantities keep four decimal places.
- Sales shipping is displayed separately so subtotal - discount + tax + shipping
  reconciles with the payable total.

The screen, Excel and print routes use the same ledger service and totals. Do not
introduce independent footer arithmetic in a presentation layer.

## Conversion discounts

Some marketplace orders keep promotions/waived freight as a header discount while
line discounts are zero. `effectiveOrderDiscounts` preserves existing line discounts
and distributes the missing header amount in integer cents before direct-order or
delivery-based invoicing. Already distributed discounts are not applied twice.
Provider tax snapshots are preserved rather than guessed again during conversion.
Inconsistent headers fail conversion instead of silently changing the agreed amount.

This changes future conversions. It does not rewrite posted historical invoices.
Partial invoicing retains the existing proportional quantity allocation; reconcile
rounding residuals across separately billed deliveries before closing an order.

## Profitability

Item and platform P&L deduct financial returns from revenue and units. The linked
stock return must not deduct revenue a second time. COGS is obtained separately
from stock movements, and settlement fees retain their signs.

An average selling price must be quantity weighted (net-of-tax line sales divided
by units), not the unweighted average of document line prices.

## Read-only reconciliation

Run `scripts/checks/audit-financial-invariants.sql` with an authorized database
administrator using `psql -X -v ON_ERROR_STOP=1`. It starts a REPEATABLE READ,
READ ONLY transaction, sets a statement timeout, emits counts only, and rolls back.
It never repairs data or posts entries. The header-only order-discount count is a
distribution warning, not proof that an order total is wrong.

Controls include journal balance, document arithmetic, invoice remaining balances,
discount consistency, negative stock, inventory GL reconciliation and missing
invoice journals. A balanced journal alone does not prove a transaction was valued
correctly: also reconcile source contracts, financial statements and subledgers.

Keep tenant-level findings, document lists and repair previews outside the public
repository. Historical adjustments require a verified source, backup, agreed
accounting date, recorded reason, and review of VAT, payments and closed periods.
Do not overwrite posted records merely to make a report look consistent. Stock
reconciliation also needs physical-count confirmation when quantities differ.

## Scope and limits

The automated checks are arithmetic and reconciliation controls, not an independent
statutory audit. They do not prove physical stock, bank balances, tax treatment,
marketplace settlement completeness or every document's commercial validity.
Ranking reports of gross invoice activity must not be presented as net-of-returns
profit reports. Date ranges, currency basis and tax inclusion must remain explicit.
