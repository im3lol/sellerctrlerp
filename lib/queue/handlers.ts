import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import type { SyncJob } from "./queues";
import { db } from "@/lib/db";
import { organizationMembers, organizations } from "@/db/schema";
import { withPlatformScope } from "@/lib/db-scope";
import { backupOrgToStorage, pruneBackups } from "@/lib/erp/backup";
import { log } from "@/lib/log";
import { startRun, finishRun } from "@/lib/erp/sync-runs";
import { prepareSync, syncProductsCore, importProductsCore, syncOrdersCore, syncSettlementsCore, syncReturnsCore, syncReimbursementsCore, syncLedgerCore, syncFeesCore, markSync, type SyncPrep, type ProductsSync } from "@/lib/erp/marketplace/sync-core";
import { runInventoryAudit } from "@/lib/erp/marketplace/inventory-audit-core";
import { runWithErpContext, type ErpContext } from "@/lib/erp/erp-context";
import { withRequestCount } from "@/lib/erp/marketplace/amazon/client";
import { allErpPermissions } from "@/lib/erp/permissions";

/**
 * Ambient ERP identity for queue jobs. The orders flow reuses the cookie-bound
 * server actions (fulfillOrder → create/confirm delivery → invoice), and in the
 * worker there is no request scope — `authorizeErp` would crash on `cookies()`.
 * Same mechanism the Bearer API uses: run the job inside an ErpContext, acting
 * as the org's admin (falls back to the oldest active member).
 */
async function workerErpContext(orgId: string): Promise<ErpContext | null> {
  const [m] = await db
    .select({ userId: organizationMembers.userId, role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true)))
    .orderBy(sql`case when ${organizationMembers.role} = 'admin' then 0 else 1 end`, asc(organizationMembers.joinedAt))
    .limit(1);
  if (!m) return null;
  return { userId: m.userId, orgId, role: "admin", permissions: new Set(allErpPermissions) };
}

// Job handlers. IMPORT does the complete Reports-API enumeration; DISCOVERY does the
// fast incremental listings pull. Phase 3 splits enrichment into details/images queues.

async function runProducts(d: SyncJob, kind: "IMPORT" | "DISCOVERY", run: (p: SyncPrep) => Promise<ProductsSync>): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, kind, d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  const [r, apiRequests] = await withRequestCount(() => run(prep));
  if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
  await markSync(d.orgId, d.provider, { lastSyncStatus: kind === "IMPORT" ? "ok" : "auto", needsReauth: false, productsSyncedAt: new Date() });
  await finishRun(d.orgId, runId, "OK", { productsProcessed: r.total, newProducts: r.created, updatedProducts: r.linked, apiRequests });
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
  const ctx = await workerErpContext(d.orgId);
  if (!ctx) { await finishRun(d.orgId, runId, "FAILED", {}, "لا يوجد عضو نشط في المؤسسة لتشغيل المزامنة"); return; }
  try {
    const from = d.since ? new Date(d.since) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Watermark = the fetch window's END (captured before the pull), not finish time —
    // a slow paced pull would otherwise blind the next window to mid-run updates.
    const to = new Date();
    const [r, apiRequests] = await withRequestCount(() => runWithErpContext(ctx, () => syncOrdersCore(prep, ctx.userId, { from, to, mode: d.ordersMode ?? "updated" })));
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    // Only advance the watermark when every order landed — a transient insert
    // failure on an already-Shipped order (no future update event) would otherwise
    // be silently lost; re-scanning the same window is safe (dedup skips repeats).
    await markSync(d.orgId, d.provider, r.failed > 0 ? { lastSyncStatus: "auto", needsReauth: false } : { lastSyncStatus: "auto", needsReauth: false, ordersSyncedAt: to });
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.created, newProducts: r.created, failedProducts: r.failed, apiRequests });
  } catch (e) {
    console.error("[queue] order sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة المبيعات");
  }
}

/** Pull scheduled Amazon settlement reports (payments) → upsert rows, and post to
 *  GL only when the platform's auto-post is on. `since` from the cron watermark. */
export async function runSettlementsJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "SETTLEMENTS", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  if (!prep.flags.settlements) { await finishRun(d.orgId, runId, "OK", {}); return; } // source toggled off
  // Ambient identity: the refund cycle inside postSettlements runs cookie-bound
  // server actions (credit note + delivery return) — same need as runOrdersJob.
  const ctx = await workerErpContext(d.orgId);
  if (!ctx) { await finishRun(d.orgId, runId, "FAILED", {}, "لا يوجد عضو نشط في المؤسسة لتشغيل المزامنة"); return; }
  // Always advance the watermark — even on failure — so the scheduler backs off to
  // the 12h cadence instead of re-enqueuing every 60s and hammering the low reports
  // quota. It's a cadence timer, NOT the data window: the pull always re-scans a
  // fixed 90-day window (settlement reports are few; dedup drops repeats → gapless).
  await markSync(d.orgId, d.provider, { settlementsSyncedAt: new Date() });
  try {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [r, apiRequests] = await withRequestCount(() => runWithErpContext(ctx, () => syncSettlementsCore(prep, { from, to: new Date() })));
    if (!r.ok) { await markSync(d.orgId, d.provider, { lastSyncStatus: "error" }); await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    await markSync(d.orgId, d.provider, { lastSyncStatus: "auto", needsReauth: false });
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.imported + r.updated, newProducts: r.imported, updatedProducts: r.posted, apiRequests });
  } catch (e) {
    console.error("[queue] settlement sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة التسويات");
  }
}

/** Read-only Inventory Audit — compares Amazon FBA vs ERP + stores a snapshot. */
export async function runInventoryAuditJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "INVENTORY", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  try {
    const [r, apiRequests] = await withRequestCount(() => runInventoryAudit(prep));
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.totalSkus, newProducts: r.withDiff, apiRequests });
  } catch (e) {
    console.error("[queue] inventory audit failed:", e);
    // Keep the stored message short — never dump a raw SQL error to the UI.
    const msg = (e instanceof Error ? e.message : "").slice(0, 200) || "فشل تدقيق المخزون";
    await finishRun(d.orgId, runId, "FAILED", {}, msg);
  }
}

/** Pull FBA customer returns → upsert + create/link DRAFT مرتجعات. Needs the
 *  worker's ambient ERP identity (createSalesReturnAction authorizes). Watermark
 *  advances up-front like settlements — a 12h cadence timer, not a data window
 *  (the pull re-scans a fixed 60-day window; dedup drops repeats). */
export async function runReturnsJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "RETURNS", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  if (!prep.flags.returns) { await finishRun(d.orgId, runId, "OK", {}); return; } // source toggled off
  const ctx = await workerErpContext(d.orgId);
  if (!ctx) { await finishRun(d.orgId, runId, "FAILED", {}, "لا يوجد عضو نشط في المؤسسة لتشغيل المزامنة"); return; }
  await markSync(d.orgId, d.provider, { returnsSyncedAt: new Date() });
  try {
    const from = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const [r, apiRequests] = await withRequestCount(() => runWithErpContext(ctx, () => syncReturnsCore(prep, { from, to: new Date() })));
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.imported, newProducts: r.created, updatedProducts: r.linkedToSettlement, failedProducts: r.unmatched, apiRequests });
  } catch (e) {
    console.error("[queue] returns sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة المرتجعات");
  }
}

/** Read-only FBA reimbursements feed (no documents → no ErpContext). */
export async function runReimbursementsJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "REIMBURSEMENTS", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  await markSync(d.orgId, d.provider, { reimbursementsSyncedAt: new Date() });
  try {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [r, apiRequests] = await withRequestCount(() => syncReimbursementsCore(prep, { from, to: new Date() }));
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.imported + r.skipped, newProducts: r.imported, apiRequests });
  } catch (e) {
    console.error("[queue] reimbursements sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة التعويضات");
  }
}

/** Read-only FBA ledger detail feed. */
export async function runLedgerJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "LEDGER", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  await markSync(d.orgId, d.provider, { ledgerSyncedAt: new Date() });
  try {
    const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [r, apiRequests] = await withRequestCount(() => syncLedgerCore(prep, { from, to: new Date() }));
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.imported + r.skipped, newProducts: r.imported, apiRequests });
  } catch (e) {
    console.error("[queue] ledger sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل مزامنة دفتر FBA");
  }
}

/** Refresh estimated Amazon fees for every linked item (weekly / on demand). */
export async function runPricingJob(d: SyncJob): Promise<void> {
  const runId = await startRun(d.orgId, d.provider, "PRICING", d.marketplaceId);
  const prep = await prepareSync(d.orgId, d.provider.toUpperCase());
  if ("error" in prep) { await finishRun(d.orgId, runId, "FAILED", {}, prep.error); return; }
  await markSync(d.orgId, d.provider, { feesSyncedAt: new Date() });
  try {
    const [r, apiRequests] = await withRequestCount(() => syncFeesCore(prep));
    if (!r.ok) { await finishRun(d.orgId, runId, "FAILED", { apiRequests }, r.error); return; }
    await finishRun(d.orgId, runId, "OK", { productsProcessed: r.itemsConsidered, updatedProducts: r.estimated, apiRequests });
  } catch (e) {
    console.error("[queue] fees sync failed:", e);
    await finishRun(d.orgId, runId, "FAILED", {}, (e instanceof Error ? e.message : "").slice(0, 200) || "فشل تقدير الرسوم");
  }
}

/** Per-tenant daily maintenance: the safety backup to object storage + prune to the
 *  last 14. Fanning this out of the cron's serial per-org loop (which timed out on a
 *  large fleet) into one job per org — the heavy full-DB export now runs concurrently
 *  under the worker's fairness limits instead of blocking a 60s serverless function. */
export async function runMaintenanceJob(d: SyncJob): Promise<void> {
  await withPlatformScope(async () => {
    const [org] = await db.select({ name: organizations.nameAr }).from(organizations).where(eq(organizations.id, d.orgId)).limit(1);
    if (!org) return;
    try {
      await backupOrgToStorage(d.orgId, org.name);
      await pruneBackups(d.orgId, 14);
    } catch (e) {
      log.warn("maintenance.backup_failed", { orgId: d.orgId, err: e });
    }
  });
}
