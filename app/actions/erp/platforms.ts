"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { salesPlatforms, customers, warehouses, bankAccounts, items, itemCodes, salesOrders, salesOrderLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { round2 } from "@/lib/erp/money";
import { normalizeCode } from "@/lib/erp/amazon-import";
import { tryRecordAudit } from "@/lib/erp/audit";

const codeSchema = z.string().trim().min(2, "الكود قصير جدًا").max(20, "الكود طويل جدًا")
  .regex(/^[A-Za-z0-9_-]+$/, "الكود بحروف إنجليزية/أرقام فقط");

const schema = z.object({
  name: z.string().trim().min(2, "اسم المنصة مطلوب"),
  code: codeSchema,
  integrationType: z.enum(["amazon", "generic"]).default("generic"),
  defaultWarehouseId: z.string().optional().nullable(),
  bankAccountId: z.string().optional().nullable(),
});

/** Validate that an optional FK id belongs to the active org (or is empty). */
async function belongsToOrg(orgId: string, id: string | null | undefined, table: typeof warehouses | typeof bankAccounts): Promise<boolean> {
  if (!id) return true;
  const [row] = await db.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.organizationId, orgId))).limit(1);
  return Boolean(row);
}

/**
 * Create a sales platform (Amazon, Noon, …). Auto-creates a customer with the
 * same name (get-or-create by the platform code) and links it, plus an optional
 * default warehouse and settlement bank account.
 */
export async function createPlatformAction(input: unknown): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, integrationType, defaultWarehouseId, bankAccountId } = parsed.data;
  const code = parsed.data.code.toUpperCase();

  const [dup] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, auth.orgId), eq(salesPlatforms.code, code))).limit(1);
  if (dup) return { error: "يوجد منصة بنفس الكود بالفعل" };

  if (!(await belongsToOrg(auth.orgId, defaultWarehouseId, warehouses))) return { error: "المخزن غير موجود" };
  if (!(await belongsToOrg(auth.orgId, bankAccountId, bankAccounts))) return { error: "الحساب البنكي غير موجود" };

  try {
    const id = await db.transaction(async (tx) => {
      // Auto-create (or reuse) the platform's customer, keyed by the platform code.
      let [cust] = await tx.select({ id: customers.id }).from(customers)
        .where(and(eq(customers.organizationId, auth.orgId), eq(customers.code, code))).limit(1);
      if (!cust) {
        [cust] = await tx.insert(customers)
          .values({ organizationId: auth.orgId, code, nameAr: name })
          .returning({ id: customers.id });
      }

      const [platform] = await tx.insert(salesPlatforms).values({
        organizationId: auth.orgId,
        name,
        code,
        integrationType,
        customerId: cust.id,
        defaultWarehouseId: defaultWarehouseId || null,
        bankAccountId: bankAccountId || null,
      }).returning({ id: salesPlatforms.id });
      return platform.id;
    });
    revalidatePath("/erp/platforms");
    return { ok: true, id };
  } catch {
    return { error: "تعذّر إنشاء المنصة" };
  }
}

/** Update a platform's name, integration type, warehouse, or bank account (code is immutable). */
export async function updatePlatformAction(id: string, input: unknown): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.partial().safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, integrationType, defaultWarehouseId, bankAccountId } = parsed.data;

  const [platform] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
  if (!platform) return { error: "المنصة غير موجودة" };

  if (!(await belongsToOrg(auth.orgId, defaultWarehouseId, warehouses))) return { error: "المخزن غير موجود" };
  if (!(await belongsToOrg(auth.orgId, bankAccountId, bankAccounts))) return { error: "الحساب البنكي غير موجود" };

  await db.update(salesPlatforms).set({
    ...(name !== undefined ? { name } : {}),
    ...(integrationType !== undefined ? { integrationType } : {}),
    defaultWarehouseId: defaultWarehouseId || null,
    bankAccountId: bankAccountId || null,
    updatedAt: new Date(),
  }).where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, auth.orgId)));
  revalidatePath("/erp/platforms");
  return { ok: true };
}

// ── Generic order import ─────────────────────────────────────

const importLineSchema = z.object({
  code: z.string().trim().min(1),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0),
});
const importOrderSchema = z.object({
  externalOrderId: z.string().trim().min(1),
  date: z.string().optional(),
  lines: z.array(importLineSchema).min(1),
});

export type PlatformImportResult =
  | { ok: true; created: number; skippedDuplicate: number; unmatched: string[] }
  | { ok: false; error: string };

/**
 * Import marketplace orders for a platform (generic CSV path). Each external order
 * becomes one DRAFT sales order billed to the platform's customer, stocked from its
 * default warehouse, deduplicated by (org, channel = platform code, externalOrderId).
 * Orders with any unmatched SKU are skipped and reported so codes can be linked first.
 */
export async function importPlatformOrdersAction(platformId: string, ordersInput: unknown): Promise<PlatformImportResult> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return { ok: false, error: auth.error };

  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, platformId), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
  if (!platform) return { ok: false, error: "المنصة غير موجودة" };
  if (!platform.isActive) return { ok: false, error: "المنصة موقوفة" };
  if (!platform.customerId) return { ok: false, error: "المنصة بلا عميل مرتبط" };

  const parsed = z.array(importOrderSchema).safeParse(ordersInput);
  if (!parsed.success) return { ok: false, error: "بيانات الاستيراد غير صالحة" };
  const orders = parsed.data;
  if (orders.length === 0) return { ok: false, error: "لا توجد أوامر في الملف" };

  // Item matcher: item_codes (SKU/barcode) then item.code, both normalized.
  const norms = [...new Set(orders.flatMap((o) => o.lines.map((l) => normalizeCode(l.code))).filter(Boolean))];
  const codeRows = norms.length
    ? await db.select({ norm: itemCodes.normalizedCode, itemId: itemCodes.itemId }).from(itemCodes)
        .where(and(eq(itemCodes.organizationId, auth.orgId), inArray(itemCodes.normalizedCode, norms)))
    : [];
  const byNorm = new Map<string, string>();
  for (const r of codeRows) if (r.norm) byNorm.set(r.norm, r.itemId);
  const itemRows = await db.select({ id: items.id, code: items.code }).from(items).where(eq(items.organizationId, auth.orgId));
  const byItemCode = new Map<string, string>();
  for (const it of itemRows) byItemCode.set(normalizeCode(it.code), it.id);
  const matchItem = (code: string) => { const n = normalizeCode(code); return byNorm.get(n) ?? byItemCode.get(n) ?? null; };

  // Dedup against orders already imported for this channel.
  const existing = await db.select({ ext: salesOrders.externalOrderId }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, auth.orgId), eq(salesOrders.channel, platform.code)));
  const existingExt = new Set(existing.map((e) => e.ext).filter(Boolean) as string[]);

  const unmatched = new Set<string>();
  let created = 0, skippedDuplicate = 0;

  for (const o of orders) {
    if (existingExt.has(o.externalOrderId)) { skippedDuplicate++; continue; }
    const resolved = o.lines.map((l) => ({ ...l, itemId: matchItem(l.code) }));
    const missing = resolved.filter((l) => !l.itemId);
    if (missing.length) { for (const m of missing) unmatched.add(m.code); continue; }

    const d = o.date ? new Date(o.date) : new Date();
    const orderDate = isNaN(d.getTime()) ? new Date() : d;
    const subtotal = round2(resolved.reduce((s, l) => s + l.quantity * l.unitPrice, 0));

    try {
      await db.transaction(async (tx) => {
        const number = await nextDocumentNumber(tx, auth.orgId, "SO", orderDate.getFullYear());
        const [so] = await tx.insert(salesOrders).values({
          organizationId: auth.orgId, number, customerId: platform.customerId!, date: orderDate, status: "DRAFT",
          subtotal: String(subtotal), totalAmount: String(subtotal),
          channel: platform.code, platformId: platform.id, externalOrderId: o.externalOrderId,
          notes: `استيراد ${platform.name} (${o.externalOrderId})`,
        }).returning({ id: salesOrders.id });
        await tx.insert(salesOrderLines).values(resolved.map((l) => ({
          salesOrderId: so.id, itemId: l.itemId!, warehouseId: platform.defaultWarehouseId,
          quantity: String(l.quantity), unitPrice: String(l.unitPrice), totalAmount: String(round2(l.quantity * l.unitPrice)),
        })));
        await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "SALES_ORDER", entityId: so.id, entityNumber: number, summary: `استيراد أمر بيع ${number} من ${platform.name} (${o.externalOrderId})`, metadata: { platform: platform.code, externalOrderId: o.externalOrderId, total: subtotal } });
      });
      existingExt.add(o.externalOrderId);
      created++;
    } catch { /* skip a failed row, keep importing the rest */ }
  }

  revalidatePath("/erp/sales/orders");
  revalidatePath(`/erp/platforms/${platformId}/import`);
  return { ok: true, created, skippedDuplicate, unmatched: [...unmatched] };
}

/** Toggle a platform active/inactive. */
export async function togglePlatformActiveAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const [p] = await db.select({ isActive: salesPlatforms.isActive }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, auth.orgId))).limit(1);
  if (!p) return { error: "المنصة غير موجودة" };
  await db.update(salesPlatforms).set({ isActive: !p.isActive, updatedAt: new Date() })
    .where(and(eq(salesPlatforms.id, id), eq(salesPlatforms.organizationId, auth.orgId)));
  revalidatePath("/erp/platforms");
  return { ok: true };
}
