"use server";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { syncRuns } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { prepareSync } from "@/lib/erp/marketplace/sync-core";
import { runInventoryAudit } from "@/lib/erp/marketplace/inventory-audit-core";
import { enqueue, QUEUES } from "@/lib/queue/queues";

type AuditStatus = { phase: "running" | "done" | "error" | "idle"; totalSkus?: number; withDiff?: number; error?: string };

/**
 * Start a read-only Inventory Audit (Amazon FBA vs ERP). Runs in the BACKGROUND
 * (pulls the whole FBA catalog — minutes) and stores a snapshot the reconciliation
 * screen reads. NEVER changes stock.
 */
export async function startInventoryAuditAction(code: string): Promise<{ ok: boolean; error?: string; started?: boolean }> {
  const auth = await authorizeErp("inventory.view", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.connector.fetchInventoryDetail) return { ok: false, error: "المنصة لا تدعم مخزون FBA" };
  if (!p.ctx.warehouseId) return { ok: false, error: "اضبط المخزن الافتراضي للمنصة أولًا" };

  if (await enqueue(QUEUES.inventory, { orgId: p.orgId, provider: p.provider, marketplaceId: p.cred.marketplaceId ?? undefined })) {
    return { ok: true, started: true };
  }
  try {
    await runInventoryAudit(p); // inline fallback (no Redis)
    return { ok: true, started: false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "فشل تدقيق المخزون" };
  }
}

/** Poll the background audit (latest INVENTORY sync_run). */
export async function inventoryAuditStatusAction(code: string): Promise<AuditStatus> {
  const auth = await authorizeErp("inventory.view", "marketplace");
  if ("error" in auth) return { phase: "idle" };
  const provider = code.toLowerCase();
  const [row] = await withOrgScope(auth.orgId, false, () =>
    db.select().from(syncRuns)
      .where(and(eq(syncRuns.organizationId, auth.orgId), eq(syncRuns.provider, provider), eq(syncRuns.kind, "INVENTORY")))
      .orderBy(desc(syncRuns.startedAt)).limit(1));
  if (!row) return { phase: "running" }; // enqueued; worker hasn't written its row yet
  const phase = row.status === "OK" ? "done" : row.status === "FAILED" ? "error" : "running";
  return { phase, totalSkus: row.productsProcessed, withDiff: row.newProducts, error: row.error ?? undefined };
}
