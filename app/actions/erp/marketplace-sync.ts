"use server";

import { revalidatePath } from "next/cache";
import { authorizeErp } from "@/lib/erp/action-auth";
import {
  prepareSync, markSync, syncProductsCore, syncOrdersCore, syncInventoryCore,
  type ProductsSync, type OrdersSync, type InventorySync,
} from "@/lib/erp/marketplace/sync-core";


const LOOKBACK_DAYS = 30;

/** Step 1 — sync the product catalog (link existing + create new + enrichment). */
export async function syncProductsAction(code: string): Promise<ProductsSync> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.products) return { ok: false, error: "مزامنة المنتجات موقوفة لهذه المنصّة" };
  const r = await syncProductsCore(p);
  if (r.ok) await markSync(p.orgId, p.provider, { lastSyncStatus: "ok", productsSyncedAt: new Date() });
  revalidatePath("/erp/inventory/items");
  return r;
}

/** Step 2 — sync sales (orders, last 30 days) through the sales-order cycle. */
export async function syncOrdersAction(code: string): Promise<OrdersSync> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.orders) return { ok: false, error: "مزامنة المبيعات موقوفة لهذه المنصّة" };
  const to = new Date();
  const from = new Date(to.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const r = await syncOrdersCore(p, auth.userId, { from, to });
  if (r.ok) await markSync(p.orgId, p.provider, { lastSyncStatus: "ok" });
  revalidatePath("/erp/sales/orders");
  return r;
}

/** Step 3 — reconcile inventory (read-only preview; confirmed separately). */
export async function syncInventoryAction(code: string): Promise<InventorySync> {
  const auth = await authorizeErp("sales.create", "marketplace");
  if ("error" in auth) return { ok: false, error: auth.error };
  const p = await prepareSync(auth.orgId, code);
  if ("error" in p) return { ok: false, error: p.error };
  if (!p.flags.inventory) return { ok: false, error: "مزامنة المخزون موقوفة لهذه المنصّة" };
  const r = await syncInventoryCore(p);
  revalidatePath(`/erp/platforms/${p.provider}`);
  return r;
}
