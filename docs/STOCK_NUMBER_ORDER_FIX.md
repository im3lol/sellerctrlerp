# Stock movement number ordering — 2026-10-20

## Incident
Inventory overview for an imported company failed with Next error digest `613346626`.
PostgreSQL rejected `split_part(number, '-', 3)::int` because an existing movement had an alphanumeric suffix.
The production HTTP response was 200 but contained the streamed server-error digest.

## Fix
All unguarded stock movement suffix casts in application queries now use the same numeric guard already used by the posting engine and stock balance report:

```sql
CASE WHEN split_part(number, '-', 3) ~ '^[0-9]+$'
     THEN split_part(number, '-', 3)::numeric ELSE 0 END
```

Creation time remains the primary movement order. Numeric suffixes remain numeric, including values over 9999 or the PostgreSQL integer limit. Legacy/non-numeric suffixes use the existing engine fallback of zero. No movement, quantity, valuation, document, or schema is modified.
Document sequence reconstruction is intentionally unchanged: it already filters to strictly numeric document numbers.

## Validation
- `node --env-file=.env scripts/checks/chk-stock-number-order.mjs`: source regression scan and real PostgreSQL identifier/overflow cases.
- Exact corrected inventory overview balance query against the affected company: 62 rows; read-only transaction rolled back.
- Landed cost and document deletion suites: 29 tests passed.
- `scripts/checks/chk-stock-pages.mjs`: authenticated read-only rendered-page smoke, local deployment only; requires `STOCK_SMOKE_ORG`.

## Deployment verification
Build `OypH5rpMmRaIKLDUgwGO-` deployed to app and worker; both healthy.
All seven authenticated page checks passed for the affected company after deployment: inventory overview, items, stock balances, ledger, dead stock, new transfer, new adjustment.
The same smoke failed on the original overview before deployment, confirming the regression check detects the incident.
Public health endpoint returned `ok: true`, DB/Redis up. No matching cast error or digest in the restarted application logs.
Rollback images: `sellerctrl-app:before-stock-number-fix-20261020` and `sellerctrl-worker:before-stock-number-fix-20261020`.
