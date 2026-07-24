import "server-only";
import { db } from "@/lib/db";
import { fbaReimbursements, fbaLedgerEvents } from "@/db/schema";
import type { FbaReimbursementRow } from "@/lib/erp/amazon-reimbursements";
import { ledgerDedupKey, type FbaLedgerRow } from "@/lib/erp/amazon-ledger";

// Read-only FBA finance feeds: idempotent upserts, no GL, no stock. Caller holds
// the org RLS scope.

export async function upsertReimbursements(orgId: string, rows: FbaReimbursementRow[]): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };
  const values = rows.map((r) => ({
    organizationId: orgId, channel: "AMAZON", reimbursementId: r.reimbursementId,
    approvalDate: r.approvalDate, caseId: r.caseId || null, orderId: r.orderId || null,
    sku: r.sku || null, fnsku: r.fnsku || null, asin: r.asin || null, reason: r.reason || null,
    currency: r.currency || null, amountPerUnit: String(r.amountPerUnit), amountTotal: String(r.amountTotal),
    quantityReimbursedCash: String(r.quantityReimbursedCash), quantityReimbursedInventory: String(r.quantityReimbursedInventory),
    raw: r as unknown,
  }));
  // One report can repeat (id, sku) across windows — last row wins pre-insert.
  const byKey = new Map(values.map((v) => [`${v.reimbursementId}|${v.sku ?? ""}`, v]));
  const merged = [...byKey.values()];
  let imported = 0;
  for (let i = 0; i < merged.length; i += 500) {
    const ins = await db.insert(fbaReimbursements).values(merged.slice(i, i + 500))
      .onConflictDoNothing({ target: [fbaReimbursements.organizationId, fbaReimbursements.reimbursementId, fbaReimbursements.sku] })
      .returning({ id: fbaReimbursements.id });
    imported += ins.length;
  }
  return { imported, skipped: rows.length - imported };
}

export async function upsertLedgerEvents(orgId: string, rows: FbaLedgerRow[]): Promise<{ imported: number; skipped: number }> {
  if (rows.length === 0) return { imported: 0, skipped: 0 };
  const values = rows.map((r) => ({
    organizationId: orgId, channel: "AMAZON", eventDate: r.eventDate, sku: r.sku || null,
    fnsku: r.fnsku || null, asin: r.asin || null, eventType: r.eventType,
    referenceId: r.referenceId || null, quantity: String(r.quantity),
    fulfillmentCenter: r.fulfillmentCenter || null, disposition: r.disposition || null,
    reason: r.reason || null, country: r.country || null, dedupKey: ledgerDedupKey(r), raw: r as unknown,
  }));
  const byKey = new Map(values.map((v) => [v.dedupKey, v]));
  const merged = [...byKey.values()];
  let imported = 0;
  for (let i = 0; i < merged.length; i += 500) {
    const ins = await db.insert(fbaLedgerEvents).values(merged.slice(i, i + 500))
      .onConflictDoNothing({ target: [fbaLedgerEvents.organizationId, fbaLedgerEvents.dedupKey] })
      .returning({ id: fbaLedgerEvents.id });
    imported += ins.length;
  }
  return { imported, skipped: rows.length - imported };
}
