"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, platformCredentials } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { decryptSecret } from "@/lib/crypto";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { getConnector } from "@/lib/erp/marketplace/registry";
import { ingestOrders, reconcileInventory, type PlatformCtx } from "@/lib/erp/marketplace/ingest";
import type { Credential } from "@/lib/erp/marketplace/connector";

export type SyncSummary =
  | {
      ok: true;
      orders?: { created: number; fulfilled: number; transitioned: number; skippedDuplicate: number; skippedUnmatched: number; stockBlocked: number };
      inventory?: { matched: number; withDiff: number; unmatched: number };
      errors: string[];
    }
  | { ok: false; error: string };

const DEFAULT_LOOKBACK_DAYS = 30;

/** Resolve the platform write-context for a connector code. */
async function resolveCtx(orgId: string, code: string): Promise<PlatformCtx | { error: string }> {
  if (code === "AMAZON") {
    const p = await ensureAmazonPlatform(orgId);
    return { platformId: p.platformId, customerId: p.customerId, warehouseId: p.warehouseId, channel: "AMAZON", label: "طلب أمازون" };
  }
  const [p] = await db.select({ id: salesPlatforms.id, customerId: salesPlatforms.customerId, warehouseId: salesPlatforms.defaultWarehouseId, name: salesPlatforms.name })
    .from(salesPlatforms).where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, code))).limit(1);
  if (!p?.customerId) return { error: "المنصة بلا عميل مرتبط" };
  return { platformId: p.id, customerId: p.customerId, warehouseId: p.warehouseId, channel: code, label: p.name };
}

/**
 * Pull from a connected marketplace and ingest via the shared core: orders →
 * sales-order cycle; inventory → a read-only reconciliation (the user still
 * confirms the DRAFT adjustment). Best-effort per source — one failing source is
 * reported but doesn't block the other. Records last-sync status on the connection.
 */
export async function syncPlatformAction(code: string): Promise<SyncSummary> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const provider = code.toLowerCase();
  const connector = getConnector(code);
  if (!connector) return { ok: false, error: "لا يوجد موصّل لهذه المنصة" };

  const [row] = await db.select().from(platformCredentials)
    .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider))).limit(1);
  if (!row) return { ok: false, error: "المنصة غير مربوطة — اربط الحساب أولًا" };

  const refreshToken = decryptSecret(row.refreshToken);
  if (!refreshToken) return { ok: false, error: "تعذّر فك تشفير التوكن — أعد ربط الحساب" };
  const cred: Credential = { refreshToken, sellerId: row.sellerId, marketplaceId: row.marketplaceId, region: row.region };

  const ctx = await resolveCtx(auth.orgId, connector.code);
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const to = new Date();
  const from = new Date(to.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const errors: string[] = [];
  const out: Extract<SyncSummary, { ok: true }> = { ok: true, errors };

  if (connector.fetchOrders) {
    try {
      const orders = await connector.fetchOrders(cred, { from, to });
      const r = await ingestOrders(auth.orgId, auth.userId, ctx, orders);
      out.orders = { created: r.created, fulfilled: r.fulfilled, transitioned: r.transitioned, skippedDuplicate: r.skippedDuplicate, skippedUnmatched: r.skippedUnmatched, stockBlocked: r.stockBlocked.length };
    } catch (e) {
      errors.push(`الأوامر: ${e instanceof Error ? e.message : "فشل السحب"}`);
    }
  }

  if (connector.fetchInventory && ctx.warehouseId) {
    try {
      const inv = await connector.fetchInventory(cred);
      const rec = await reconcileInventory(auth.orgId, { defaultWarehouseId: ctx.warehouseId }, inv);
      if (rec.ok) out.inventory = { matched: rec.result.matched, withDiff: rec.result.withDiff, unmatched: rec.result.unmatched };
      else errors.push(`المخزون: ${rec.error}`);
    } catch (e) {
      errors.push(`المخزون: ${e instanceof Error ? e.message : "فشل السحب"}`);
    }
  }

  await db.update(platformCredentials)
    .set({ lastSyncAt: new Date(), lastSyncStatus: errors.length ? errors.join(" · ") : "ok", updatedAt: new Date() })
    .where(and(eq(platformCredentials.organizationId, auth.orgId), eq(platformCredentials.provider, provider)));

  revalidatePath("/erp/sales/orders");
  revalidatePath(`/erp/platforms/${provider}`);
  return out;
}
