"use server";

import { revalidatePath } from "next/cache";
import { round2 } from "@/lib/erp/money";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes, salesOrders, salesOrderLines } from "@/db/schema";
import { ensureAmazonPlatform } from "@/lib/erp/platform-provision";
import { authorizeErp } from "@/lib/erp/action-auth";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { tryRecordAudit } from "@/lib/erp/audit";
import { confirmSalesOrderAction } from "@/app/actions/erp/sales-orders";
import { fulfillOrder } from "@/lib/erp/fulfillment";
import { parseAmazonWorkbook, groupAmazonOrders, normalizeCode, type AmazonOrder } from "@/lib/erp/amazon-import";

const CHANNEL = "AMAZON";
type MatchedLine = {
  sku: string; asin: string; productName: string;
  qty: number; unitPrice: number; lineTotal: number; shippingPrice: number;
  itemId: string | null; itemName: string | null;
};
export type PreviewOrder = {
  orderId: string; date: string; status: string;
  subtotal: number; shippingTotal: number; total: number;
  lines: MatchedLine[];
  existingId?: string; // set for a Shipped transition of an existing (unfulfilled) order
  existingStatus?: string;
};
export type AmazonPreview =
  | {
      ok: true;
      totalOrders: number;
      cancelledCount: number;
      zeroQtyCount: number;
      toCreate: PreviewOrder[];
      transitions: PreviewOrder[];
      duplicates: PreviewOrder[];
      blocked: PreviewOrder[];
      unmatched: { sku: string; asin: string; productName: string; sampleOrder: string }[];
    }
  | { ok: false; error: string };

export type ImportResult =
  | {
      ok: true;
      created: number;
      transitioned: number;
      fulfilled: number; // orders that went order→delivery→invoice
      stockBlocked: { orderId: string; reason: string }[]; // shipped but not enough stock
      skippedDuplicate: number;
      skippedUnmatched: number;
      failed: number;
    }
  | { ok: false; error: string };

async function readOrders(formData: FormData): Promise<{ orders: AmazonOrder[]; cancelledCount: number; zeroQtyCount: number } | { error: string }> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ارفع ملف الطلبات أولاً" };
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const lines = parseAmazonWorkbook(buf);
    return groupAmazonOrders(lines);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّرت قراءة الملف" };
  }
}

/** Build a SKU/ASIN → item resolver for the org (item_codes, then item.code). */
async function buildMatcher(orgId: string, orders: AmazonOrder[]) {
  const norms = new Set<string>();
  for (const o of orders) for (const l of o.lines) {
    if (l.sku) norms.add(normalizeCode(l.sku));
    if (l.asin) norms.add(normalizeCode(l.asin));
  }
  const normList = [...norms].filter(Boolean);
  const codeRows = normList.length
    ? await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId })
        .from(itemCodes)
        .where(and(eq(itemCodes.organizationId, orgId), inArray(itemCodes.normalizedCode, normList)))
    : [];
  const byNorm = new Map<string, string>();
  for (const r of codeRows) if (r.norm) byNorm.set(r.norm, r.itemId);

  const itemRows = await db.select({ id: items.id, code: items.code, nameAr: items.nameAr })
    .from(items).where(eq(items.organizationId, orgId));
  const nameById = new Map<string, string>();
  const byItemCode = new Map<string, string>();
  for (const it of itemRows) {
    nameById.set(it.id, it.nameAr || it.code);
    byItemCode.set(normalizeCode(it.code), it.id);
  }

  return (sku: string, asin: string): { itemId: string | null; itemName: string | null } => {
    for (const c of [sku, asin]) {
      const n = normalizeCode(c || "");
      if (!n) continue;
      const id = byNorm.get(n) ?? byItemCode.get(n);
      if (id) return { itemId: id, itemName: nameById.get(id) ?? null };
    }
    return { itemId: null, itemName: null };
  };
}

async function existingOrders(orgId: string): Promise<Map<string, { id: string; status: string }>> {
  const rows = await db.select({ ext: salesOrders.externalOrderId, id: salesOrders.id, status: salesOrders.status }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, CHANNEL)));
  const m = new Map<string, { id: string; status: string }>();
  for (const r of rows) if (r.ext) m.set(r.ext, { id: r.id, status: r.status });
  return m;
}

function classify(orders: AmazonOrder[], resolve: (sku: string, asin: string) => { itemId: string | null; itemName: string | null }, existing: Map<string, { id: string; status: string }>) {
  const toCreate: PreviewOrder[] = [];
  const transitions: PreviewOrder[] = [];
  const duplicates: PreviewOrder[] = [];
  const blocked: PreviewOrder[] = [];
  const unmatchedMap = new Map<string, { sku: string; asin: string; productName: string; sampleOrder: string }>();

  for (const o of orders) {
    const lines: MatchedLine[] = o.lines.map((l) => {
      const m = resolve(l.sku, l.asin);
      return { ...l, itemId: m.itemId, itemName: m.itemName };
    });
    const po: PreviewOrder = { orderId: o.orderId, date: o.date, status: o.status, subtotal: o.subtotal, shippingTotal: o.shippingTotal, total: o.total, lines };
    const fullyMatched = lines.every((l) => l.itemId);
    const ex = existing.get(o.orderId);
    if (ex) {
      // Existing order that is Shipped in the file but not yet fulfilled → run
      // (or resume) its cycle. Covers Pending→Shipped and stock-blocked retries.
      const done = ex.status === "CANCELLED" || ex.status === "DELIVERED" || ex.status === "INVOICED";
      if (o.status === "Shipped" && fullyMatched && !done) transitions.push({ ...po, existingId: ex.id, existingStatus: ex.status });
      else duplicates.push(po);
      continue;
    }
    if (!fullyMatched) {
      blocked.push(po);
      for (const l of lines) if (!l.itemId && l.sku && !unmatchedMap.has(l.sku)) {
        unmatchedMap.set(l.sku, { sku: l.sku, asin: l.asin, productName: l.productName, sampleOrder: o.orderId });
      }
      continue;
    }
    toCreate.push(po);
  }
  return { toCreate, transitions, duplicates, blocked, unmatched: [...unmatchedMap.values()] };
}

/** Parse + match, returning what WOULD be imported — no writes. */
export async function previewAmazonImportAction(formData: FormData): Promise<AmazonPreview> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolve = await buildMatcher(auth.orgId, parsed.orders);
  const existing = await existingOrders(auth.orgId);
  const { toCreate, transitions, duplicates, blocked, unmatched } = classify(parsed.orders, resolve, existing);

  return {
    ok: true,
    totalOrders: parsed.orders.length,
    cancelledCount: parsed.cancelledCount,
    zeroQtyCount: parsed.zeroQtyCount,
    toCreate, transitions, duplicates, blocked, unmatched,
  };
}

/**
 * Parse + match + create a sales order per eligible order, then drive the cycle:
 * Shipped → confirm + delivery + posted invoice (revenue/AR). Pending stays a
 * draft. Existing Pending orders now Shipped are transitioned + fulfilled.
 * Orders short on stock are reported (never a negative movement).
 */
export async function runAmazonImportAction(formData: FormData): Promise<ImportResult> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolve = await buildMatcher(auth.orgId, parsed.orders);
  const existing = await existingOrders(auth.orgId);
  const { toCreate, transitions, duplicates, blocked } = classify(parsed.orders, resolve, existing);
  const { platformId, customerId, warehouseId } = await ensureAmazonPlatform(auth.orgId);

  let created = 0, transitioned = 0, fulfilled = 0, failed = 0;
  const stockBlocked: { orderId: string; reason: string }[] = [];

  const insertOrder = async (o: PreviewOrder, status: string): Promise<string | null> => {
    const d = new Date(o.date || Date.now());
    try {
      return await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, auth.orgId, "SO", d.getFullYear());
        const [so] = await tx.insert(salesOrders).values({
          organizationId: auth.orgId, number, customerId, date: d, status,
          subtotal: String(o.subtotal), shippingAmount: String(o.shippingTotal),
          totalAmount: String(round2(o.subtotal + o.shippingTotal)),
          channel: CHANNEL, platformId, externalOrderId: o.orderId, notes: `طلب أمازون ${o.orderId}`,
        }).returning({ id: salesOrders.id, number: salesOrders.number });
        await tx.insert(salesOrderLines).values(o.lines.map((l) => ({
          salesOrderId: so.id, itemId: l.itemId!, warehouseId,
          quantity: String(l.qty), unitPrice: String(l.unitPrice), totalAmount: String(l.lineTotal),
        })));
        await tryRecordAudit({
          orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_ORDER",
          entityId: so.id, entityNumber: so.number,
          summary: `استيراد أمر بيع ${so.number} من أمازون (${o.orderId})`, metadata: { channel: CHANNEL, externalOrderId: o.orderId, total: o.total },
        });
        return so.id;
      });
    } catch {
      return null; // unique collision (concurrent) or per-order failure
    }
  };

  const runCycle = async (orderId: string, extId: string) => {
    const f = await fulfillOrder(auth.orgId, orderId);
    if (f.ok) { if (!f.noop) fulfilled++; }
    else if (f.blocked) stockBlocked.push({ orderId: extId, reason: f.error });
    else failed++;
  };

  for (const o of toCreate) {
    const shipped = o.status === "Shipped";
    const id = await insertOrder(o, shipped ? "CONFIRMED" : "DRAFT");
    if (!id) { failed++; continue; }
    created++;
    if (shipped) await runCycle(id, o.orderId);
  }

  for (const o of transitions) {
    if (!o.existingId) continue;
    if (o.existingStatus === "DRAFT") {
      const c = await confirmSalesOrderAction(o.existingId);
      if (!c.ok) { failed++; continue; }
      transitioned++;
    }
    await runCycle(o.existingId, o.orderId);
  }

  revalidatePath("/erp/sales/orders");
  revalidatePath("/erp/accounting");
  return {
    ok: true, created, transitioned, fulfilled, stockBlocked,
    skippedDuplicate: duplicates.length, skippedUnmatched: blocked.length, failed,
  };
}
