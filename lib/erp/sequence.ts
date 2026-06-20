import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;

/**
 * Atomically allocate the next document number `PREFIX-YYYY-NNNN` for
 * (org, key, year), where `key` is the number prefix (JV, SO, PO, SI, PI, RV,
 * PV, SR, PR, TR, AJ, DLV, GRN, DR…). The UPSERT + RETURNING is a single
 * statement, so two concurrent callers can never receive the same value — the
 * row lock taken by the UPDATE serializes them. This replaces the racy
 * "read last number + 1" pattern (a SELECT-then-INSERT two transactions could
 * interleave). Backed by the pre-existing `document_sequences` table.
 *
 * Pass a transaction handle when the number must be tied to the surrounding
 * work (a rollback then frees the number — no gap); pass `db` for a standalone
 * allocation (a later failure leaves a harmless gap).
 */
export async function nextDocumentNumber(exec: Exec, orgId: string, key: string, year: number): Promise<string> {
  const res = await exec.execute(sql`
    INSERT INTO document_sequences (organization_id, key, year, current_value)
    VALUES (${orgId}, ${key}, ${year}, 1)
    ON CONFLICT (organization_id, key, year)
    DO UPDATE SET current_value = document_sequences.current_value + 1, updated_at = now()
    RETURNING current_value
  `);
  const row = (res.rows as { current_value: number | string }[])[0];
  const value = Number(row.current_value);
  return `${key}-${year}-${String(value).padStart(4, "0")}`;
}

/** Every document table whose number is `PREFIX-YYYY-NNNN`, scanned by syncDocumentSequences. */
const NUMBERED_TABLES = [
  "journal_entries", "sales_orders", "purchase_orders", "sales_invoices", "purchase_invoices",
  "receipt_vouchers", "payment_vouchers", "sales_returns", "purchase_returns",
  "stock_transfers", "stock_adjustments", "delivery_notes", "purchase_receipts", "stock_movements",
] as const;

/**
 * Initialise/repair the sequences for an org from the numbers that already
 * exist in the document tables (e.g. after seeding rows with explicit numbers,
 * or a data import). For each (prefix, year) found, sets current_value to the
 * max NNNN seen — so the next allocation continues the series instead of
 * colliding. Idempotent (GREATEST).
 */
export async function syncDocumentSequences(orgId: string, exec: Exec = db): Promise<void> {
  for (const table of NUMBERED_TABLES) {
    await exec.execute(sql`
      INSERT INTO document_sequences (organization_id, key, year, current_value)
      SELECT organization_id,
             split_part(number, '-', 1) AS key,
             split_part(number, '-', 2)::int AS year,
             MAX(split_part(number, '-', 3)::int) AS current_value
      FROM ${sql.raw(table)}
      WHERE organization_id = ${orgId} AND number ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
      GROUP BY organization_id, split_part(number, '-', 1), split_part(number, '-', 2)::int
      ON CONFLICT (organization_id, key, year)
      DO UPDATE SET current_value = GREATEST(document_sequences.current_value, EXCLUDED.current_value), updated_at = now()
    `);
  }
}
