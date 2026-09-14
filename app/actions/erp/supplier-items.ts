"use server";

import { z } from "zod";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { items, suppliers, supplierItems } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit } from "@/lib/erp/audit";

export type SupplierItemRow = {
  supplierId: string;
  supplierName: string;
  supplierSku: string | null;
  unitPrice: number | null;
  minQty: number | null;
  leadDays: number | null;
  isPreferred: boolean;
  lastOrderedAt: string | null;
};

const rowSchema = z.object({
  supplierId: z.string().min(1, "اختر المورد"),
  supplierSku: z.string().trim().max(64).optional().nullable(),
  unitPrice: z.coerce.number().min(0, "سعر غير صالح").nullable().optional(),
  minQty: z.coerce.number().min(0, "كمية غير صالحة").nullable().optional(),
  leadDays: z.coerce.number().int("مدة التوريد بالأيام الصحيحة").min(0).max(365, "مدة التوريد لازم تكون أقل من سنة").nullable().optional(),
  isPreferred: z.boolean().default(false),
});

const saveSchema = z.object({
  itemId: z.string().min(1),
  rows: z.array(rowSchema).max(30, "٣٠ مورد للصنف أكتر من كفاية"),
});

const n = (v: string | null) => (v == null ? null : Number(v));

/** Who we buy this item from, plus the org's active suppliers for the picker. Purchase
 *  prices are purchasing information — the storekeeper's role doesn't see them. */
export async function getSupplierItemsAction(itemId: string): Promise<
  ActionState & { rows?: SupplierItemRow[]; suppliers?: { id: string; label: string }[] }
> {
  const auth = await authorizeErp("purchases.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db.select({
      supplierId: supplierItems.supplierId, supplierName: suppliers.nameAr, supplierSku: supplierItems.supplierSku,
      unitPrice: supplierItems.unitPrice, minQty: supplierItems.minQty, leadDays: supplierItems.leadDays,
      isPreferred: supplierItems.isPreferred, lastOrderedAt: supplierItems.lastOrderedAt,
    }).from(supplierItems)
      .innerJoin(suppliers, eq(suppliers.id, supplierItems.supplierId))
      .where(and(eq(supplierItems.organizationId, auth.orgId), eq(supplierItems.itemId, itemId)))
      .orderBy(asc(suppliers.nameAr));
    const sups = await db.select({ id: suppliers.id, label: suppliers.nameAr }).from(suppliers)
      .where(and(eq(suppliers.organizationId, auth.orgId), eq(suppliers.isActive, true)))
      .orderBy(asc(suppliers.nameAr));
    return {
      ok: true,
      suppliers: sups,
      rows: rows.map((r) => ({
        supplierId: r.supplierId, supplierName: r.supplierName, supplierSku: r.supplierSku,
        unitPrice: n(r.unitPrice), minQty: n(r.minQty), leadDays: r.leadDays, isPreferred: r.isPreferred,
        lastOrderedAt: r.lastOrderedAt ? new Date(r.lastOrderedAt).toISOString() : null,
      })),
    };
  });
}

/**
 * Replace an item's supplier list. A supplier that stays keeps its order history
 * (last ordered); one taken off the list leaves the catalog. Confirmed orders keep
 * adding and repricing rows on their own (lib/erp/supplier-catalog.ts).
 */
export async function saveSupplierItemsAction(input: z.input<typeof saveSchema>): Promise<ActionState> {
  const auth = await authorizeErp("purchases.edit");
  if ("error" in auth) return auth;

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { itemId, rows } = parsed.data;
  const ids = rows.map((r) => r.supplierId);
  if (new Set(ids).size !== ids.length) return { error: "المورد متكرر — كل مورد مرة واحدة للصنف" };
  if (rows.filter((r) => r.isPreferred).length > 1) return { error: "مورد مفضّل واحد بس للصنف" };

  return withOrgScope(auth.orgId, false, async () => {
    const [item] = await db.select({ code: items.code }).from(items)
      .where(and(eq(items.id, itemId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!item) return { error: "الصنف غير موجود" };
    if (ids.length) {
      const found = await db.select({ id: suppliers.id }).from(suppliers)
        .where(and(eq(suppliers.organizationId, auth.orgId), inArray(suppliers.id, ids)));
      if (found.length !== ids.length) return { error: "مورد غير موجود" };
    }

    try {
      await db.transaction(async (tx) => {
        const mine = and(eq(supplierItems.organizationId, auth.orgId), eq(supplierItems.itemId, itemId));
        await tx.delete(supplierItems).where(ids.length ? and(mine, notInArray(supplierItems.supplierId, ids)) : mine);
        // Clear the flag first: one preferred per item is a unique index, and the new one
        // may be a different row.
        await tx.update(supplierItems).set({ isPreferred: false }).where(mine);
        for (const r of rows) {
          const values = {
            supplierSku: r.supplierSku?.trim() || null,
            unitPrice: r.unitPrice != null ? String(r.unitPrice) : null,
            minQty: r.minQty != null ? String(r.minQty) : null,
            leadDays: r.leadDays ?? null,
            isPreferred: r.isPreferred,
          };
          await tx.insert(supplierItems).values({ organizationId: auth.orgId, itemId, supplierId: r.supplierId, ...values })
            .onConflictDoUpdate({
              target: [supplierItems.organizationId, supplierItems.itemId, supplierItems.supplierId],
              set: { ...values, updatedAt: new Date() },
            });
        }
        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "ITEM",
          entityId: itemId, entityNumber: item.code,
          summary: `تحديث موردي الصنف ${item.code} (${rows.length} مورد)`,
        });
      });
      revalidatePath(`/inventory/items/${encodeURIComponent(item.code)}`);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}
