"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes, customers, warehouses, salesOrders, salesOrderLines } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { tryRecordAudit } from "@/lib/erp/audit";
import { parseAmazonWorkbook, groupAmazonOrders, normalizeCode, type AmazonOrder } from "@/lib/erp/amazon-import";

const CHANNEL = "AMAZON";
const round2 = (n: number) => Math.round(n * 100) / 100;

type MatchedLine = {
  sku: string; asin: string; productName: string;
  qty: number; unitPrice: number; lineTotal: number; shippingPrice: number;
  itemId: string | null; itemName: string | null;
};
export type PreviewOrder = {
  orderId: string; date: string; status: string;
  subtotal: number; shippingTotal: number; total: number;
  lines: MatchedLine[];
};
export type AmazonPreview =
  | {
      ok: true;
      totalOrders: number;
      cancelledCount: number;
      zeroQtyCount: number;
      toCreate: PreviewOrder[];
      duplicates: PreviewOrder[];
      blocked: PreviewOrder[];
      unmatched: { sku: string; asin: string; productName: string; sampleOrder: string }[];
    }
  | { ok: false; error: string };

export type ImportResult =
  | { ok: true; created: number; skippedDuplicate: number; skippedBlocked: number; failed: number }
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

async function existingExternalIds(orgId: string): Promise<Set<string>> {
  const rows = await db.select({ ext: salesOrders.externalOrderId }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), eq(salesOrders.channel, CHANNEL)));
  return new Set(rows.map((r) => r.ext).filter((x): x is string => !!x));
}

function classify(orders: AmazonOrder[], resolve: (sku: string, asin: string) => { itemId: string | null; itemName: string | null }, existing: Set<string>) {
  const toCreate: PreviewOrder[] = [];
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
    if (existing.has(o.orderId)) { duplicates.push(po); continue; }
    if (!fullyMatched) {
      blocked.push(po);
      for (const l of lines) if (!l.itemId && l.sku && !unmatchedMap.has(l.sku)) {
        unmatchedMap.set(l.sku, { sku: l.sku, asin: l.asin, productName: l.productName, sampleOrder: o.orderId });
      }
      continue;
    }
    toCreate.push(po);
  }
  return { toCreate, duplicates, blocked, unmatched: [...unmatchedMap.values()] };
}

/** Parse + match, returning what WOULD be imported — no writes. */
export async function previewAmazonImportAction(formData: FormData): Promise<AmazonPreview> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolve = await buildMatcher(auth.orgId, parsed.orders);
  const existing = await existingExternalIds(auth.orgId);
  const { toCreate, duplicates, blocked, unmatched } = classify(parsed.orders, resolve, existing);

  return {
    ok: true,
    totalOrders: parsed.orders.length,
    cancelledCount: parsed.cancelledCount,
    zeroQtyCount: parsed.zeroQtyCount,
    toCreate, duplicates, blocked, unmatched,
  };
}

/** Get-or-create the fixed Amazon customer + Amazon FBA warehouse for the org. */
async function ensureAmazonDefaults(orgId: string): Promise<{ customerId: string; warehouseId: string }> {
  let [cust] = await db.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.organizationId, orgId), eq(customers.code, "AMZN"))).limit(1);
  if (!cust) [cust] = await db.insert(customers)
    .values({ organizationId: orgId, code: "AMZN", nameAr: "أمازون مصر", nameEn: "Amazon EG" })
    .returning({ id: customers.id });

  let [wh] = await db.select({ id: warehouses.id }).from(warehouses)
    .where(and(eq(warehouses.organizationId, orgId), eq(warehouses.code, "AMZN-FBA"))).limit(1);
  if (!wh) [wh] = await db.insert(warehouses)
    .values({ organizationId: orgId, code: "AMZN-FBA", nameAr: "أمازون FBA", nameEn: "Amazon FBA" })
    .returning({ id: warehouses.id });

  return { customerId: cust.id, warehouseId: wh.id };
}

/** Parse + match + create one sales order per eligible Amazon order. */
export async function runAmazonImportAction(formData: FormData): Promise<ImportResult> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const parsed = await readOrders(formData);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const resolve = await buildMatcher(auth.orgId, parsed.orders);
  const existing = await existingExternalIds(auth.orgId);
  const { toCreate, duplicates, blocked } = classify(parsed.orders, resolve, existing);
  if (toCreate.length === 0) {
    return { ok: true, created: 0, skippedDuplicate: duplicates.length, skippedBlocked: blocked.length, failed: 0 };
  }

  const { customerId, warehouseId } = await ensureAmazonDefaults(auth.orgId);

  let created = 0;
  let failed = 0;
  for (const o of toCreate) {
    const d = new Date(o.date || Date.now());
    const status = o.status === "Shipped" ? "CONFIRMED" : "DRAFT";
    try {
      await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, auth.orgId, "SO", d.getFullYear());
        const [so] = await tx.insert(salesOrders).values({
          organizationId: auth.orgId, number, customerId, date: d, status,
          subtotal: String(o.subtotal), shippingAmount: String(o.shippingTotal),
          totalAmount: String(round2(o.subtotal + o.shippingTotal)),
          channel: CHANNEL, externalOrderId: o.orderId,
          notes: `طلب أمازون ${o.orderId}`,
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
      });
      created++;
    } catch {
      // Unique-collision (a concurrent import already inserted this order) or any
      // per-order failure: skip it, keep importing the rest.
      failed++;
    }
  }

  revalidatePath("/erp/sales/orders");
  return { ok: true, created, skippedDuplicate: duplicates.length, skippedBlocked: blocked.length, failed };
}
