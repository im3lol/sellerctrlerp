import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { sheetsConnections, products, productStatuses } from "@/db/schema";
import { readSheet } from "@/lib/sheets";

export type SyncResult = {
  ok: boolean;
  inserted: number;
  updated: number;
  skipped: number;
  error?: string;
};

// Known locked product fields (synced FROM the sheet). Everything else
// in the column map (or unmapped) lands in baseData. Open columns
// (status, notes, amazonCode, internalNotes, assignedTo) are NEVER touched.
const LOCKED_FIELDS = ["sku", "name", "asin", "brand", "price"] as const;

async function defaultStatusId(): Promise<string | null> {
  const [s] = await db
    .select({ id: productStatuses.id })
    .from(productStatuses)
    .where(and(isNull(productStatuses.workspaceId), eq(productStatuses.isDefault, true)))
    .limit(1);
  return s?.id ?? null;
}

/** Run a sync for a single connection. Idempotent upsert keyed by (workspace, SKU). */
export async function syncConnection(connectionId: string): Promise<SyncResult> {
  const [conn] = await db
    .select()
    .from(sheetsConnections)
    .where(eq(sheetsConnections.id, connectionId))
    .limit(1);
  if (!conn) return { ok: false, inserted: 0, updated: 0, skipped: 0, error: "connection not found" };

  const map = conn.columnMap ?? {};
  const skuHeader = map.sku;
  if (!skuHeader) {
    return { ok: false, inserted: 0, updated: 0, skipped: 0, error: "لم يتم تعيين عمود SKU" };
  }

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  try {
    const { headers, rows } = await readSheet(conn.spreadsheetId, conn.sheetName, conn.headerRow);
    const statusId = await defaultStatusId();
    const mappedHeaders = new Set(Object.values(map));

    for (const row of rows) {
      const sku = (row[skuHeader] ?? "").trim();
      if (!sku) {
        skipped++;
        continue;
      }

      // Locked fields from the mapping.
      const locked: Record<string, string | null> = {};
      for (const f of LOCKED_FIELDS) {
        const header = map[f];
        if (header && row[header] != null) locked[f] = row[header];
      }
      // Unmapped columns → baseData.
      const baseData: Record<string, string> = {};
      for (const h of headers) {
        if (!mappedHeaders.has(h)) baseData[h] = row[h] ?? "";
      }

      const [existing] = await db
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.workspaceId, conn.workspaceId), eq(products.sku, sku)))
        .limit(1);

      if (existing) {
        await db
          .update(products)
          .set({
            name: locked.name ?? undefined,
            asin: locked.asin ?? undefined,
            brand: locked.brand ?? undefined,
            price: locked.price ?? undefined,
            baseData,
            sheetRowRef: row.__rowRef,
            updatedAt: new Date(),
          })
          .where(eq(products.id, existing.id));
        updated++;
      } else {
        await db.insert(products).values({
          workspaceId: conn.workspaceId,
          sku,
          name: locked.name ?? sku,
          asin: locked.asin ?? null,
          brand: locked.brand ?? null,
          price: locked.price ?? null,
          baseData,
          statusId,
          sheetRowRef: row.__rowRef,
        });
        inserted++;
      }
    }

    await db
      .update(sheetsConnections)
      .set({ lastSyncAt: new Date(), lastSyncStatus: "ok" })
      .where(eq(sheetsConnections.id, connectionId));

    return { ok: true, inserted, updated, skipped };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "sync error";
    await db
      .update(sheetsConnections)
      .set({ lastSyncAt: new Date(), lastSyncStatus: `error: ${msg}`.slice(0, 200) })
      .where(eq(sheetsConnections.id, connectionId));
    return { ok: false, inserted, updated, skipped, error: msg };
  }
}

/** Sync all connections with autoSync enabled (called by cron). */
export async function syncAllDue(): Promise<void> {
  const conns = await db
    .select({ id: sheetsConnections.id })
    .from(sheetsConnections)
    .where(eq(sheetsConnections.autoSync, true));
  for (const c of conns) {
    await syncConnection(c.id);
  }
}
