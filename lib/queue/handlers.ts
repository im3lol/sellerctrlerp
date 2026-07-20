import "server-only";
import type { SyncJob } from "./queues";
import { startRun, finishRun } from "@/lib/erp/sync-runs";
import { prepareSync, syncProductsCore, importProductsCore, syncOrdersCore, markSync, type SyncPrep, type ProductsSync } from "@/lib/erp/marketplace/sync-core";
import { runInventoryAudit } from "@/lib/erp/marketplace/inventory-audit-core";

// Job handlers. IMPORT does the complete Reports-API enumeration; DISCOVERY does the
// fast incremental listings pull. Phase 3 splits enrichment into details/images queues.

async function runProducts(d: SyncJob, kind: "IMPORT" | "DISCOVERY", run: (p: SyncPrep) => Promise<ProductsSync>): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, kind, d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  const r = await run(prep);
  if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", {}, r.error); return; }
  await markSync(d.orgId, d.provider, { lastSyncStatus: kind === "IMPORT" ? "ok" : "auto", productsSyncedAt: new Date() });
  await finishRun(d.orgId, runId, "OK", { productsProcessed: r.total, newProducts: r.created, updatedProducts: r.linked });
}

/** One-time full catalog import via the Reports API (complete, no 1000 cap). */
export function runImportJob(d: SyncJob): Promise<void> {
  return runProducts(d, "IMPORT", (p) => importProductsCore(p));
}

/** Incremental discovery of new/changed listings (fast; ≤1000 delta). `since` from
 *  the job payload → only changed listings; absent → a full pull (safe fallback). */
export function runDiscoveryJob(d: SyncJob): Promise<void> {
  const since = d.since ? new Date(d.since) : undefined;
  return runProducts(d, "DISCOVERY", (p) => syncProductsCore(p, since));
}

/** Per-item catalog detail enrichment — Phase 3. */
export function runDetailsJob(_d: SyncJob): Promise<void> { return Promise.resolve(); }

/** Per-item image enrichment — Phase 3. */
export function runImagesJob(_d: SyncJob): Promise<void> { return Promise.resolve(); }

/** Incremental Amazon order poll (near-real-time). `since` from the cron watermark;
 *  absent → last 24h. Drives the DRAFT→fulfil sales cycle + records new-order events. */
export async function runOrdersJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "ORDERS", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  try {
    const from = d.since ? new Date(d.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const r = await syncOrdersCore(prep, null, { from, to: new Date(), mode: d.ordersMode ?? "updated" });
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", {}, r.error); return; }
    await markSync(d.orgId, d.provider, { lastSyncStatus: "auto", ordersSyncedAt: new Date() });
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.created, newProducts: r.created });
  } catch (e) {
    console.error("[queue] order sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة المبيعات");
  }
}

/** Read-only Inventory Audit — compares Amazon FBA vs ERP + stores a snapshot. */
export async function runInventoryAuditJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "INVENTORY", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  try {
    const r = await runInventoryAudit(prep);
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.totalSkus, newProducts: r.withDiff });
  } catch (e) {
    console.error("[queue] inventory audit failed:", e);
    // Keep the stored message short — never dump a raw SQL error to the UI.
    const msg = (e instanceof Error ? e.message : "").slice(0, 200) || "فشل تدقيق المخزون";
    await finishRun(d.orgId, runId, "FAILED", {}, msg);
  }
}
