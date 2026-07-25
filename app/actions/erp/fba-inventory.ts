"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { syncRuns, inventoryAudits, inventoryAuditLines } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { prepareSync } from "@/lib/erp/marketplace/sync-core";
import { runInventoryAudit } from "@/lib/erp/marketplace/inventory-audit-core";
import { createStockAdjustmentAction } from "@/app/actions/erp/stock-adjustments";
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

/**
 * Create ONE DRAFT stock adjustment (جرد) from the latest completed audit's REAL
 * quantity differences — LOST (missing at Amazon) and FOUND (surplus): sets each
 * item's ERP stock to Amazon's owned total, in the audit's warehouse. DRAFT only;
 * the user reviews then confirms it (posting stock + GL) — the جرد→تسوية flow.
 * Temporary states (RECEIVING/RESEARCHING) and DAMAGED (qty matches — a
 * sellability issue, not a count issue) are deliberately skipped.
 */
export async function createAdjustmentFromAuditAction(): Promise<{ ok: boolean; id?: string; count?: number; error?: string }> {
  const auth = await authorizeErp("inventory.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  return withOrgScope(auth.orgId, false, async () => {
    const [audit] = await db.select({ id: inventoryAudits.id, warehouseId: inventoryAudits.warehouseId })
      .from(inventoryAudits)
      .where(and(eq(inventoryAudits.organizationId, auth.orgId), eq(inventoryAudits.status, "OK")))
      .orderBy(desc(inventoryAudits.createdAt)).limit(1);
    if (!audit) return { ok: false, error: "لا يوجد تدقيق مكتمل — شغّل تدقيق المخزون أولاً" };
    if (!audit.warehouseId) return { ok: false, error: "التدقيق غير مرتبط بمخزن" };

    const lines = await db.select({ itemId: inventoryAuditLines.itemId, amazonTotal: inventoryAuditLines.amazonTotal })
      .from(inventoryAuditLines)
      .where(and(eq(inventoryAuditLines.auditId, audit.id), inArray(inventoryAuditLines.status, ["LOST", "FOUND"])));
    const clean = lines.filter((l): l is { itemId: string; amazonTotal: number } => !!l.itemId);
    if (clean.length === 0) return { ok: false, error: "لا توجد فروقات كمية قابلة للتسوية في آخر تدقيق" };
    if (clean.length > 500) return { ok: false, error: "الفروقات كثيرة — عالج حتى 500 صنف في المرة" };

    const r = await createStockAdjustmentAction({
      date: new Date().toISOString().slice(0, 10),
      reason: "تسوية من تدقيق مخزون أمازون",
      lines: clean.map((l) => ({ itemId: l.itemId, warehouseId: audit.warehouseId!, mode: "set", value: l.amazonTotal })),
    });
    if (!r.ok) return { ok: false, error: r.error ?? "تعذّر إنشاء التسوية" };
    return { ok: true, id: r.id, count: clean.length };
  });
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
