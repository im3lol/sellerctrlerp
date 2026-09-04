"use server";

import { z } from "zod";
import { and, eq, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { itemUnits, unitsOfMeasure, items, purchaseOrderLines, purchaseReceiptLines, salesOrderLines, salesInvoiceLines, deliveryNoteLines } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { recordAudit } from "@/lib/erp/audit";
import { validateUnitSet } from "@/lib/erp/item-units";

const rowSchema = z.object({
  uomId: z.string().min(1, "اختر الوحدة"),
  factor: z.coerce.number().positive("المعامل لازم يكون أكبر من صفر"),
  isBase: z.boolean().default(false),
  barcode: z.string().trim().max(64).optional().nullable(),
});

const saveSchema = z.object({
  itemId: z.string().min(1),
  units: z.array(rowSchema).max(20, "٢٠ وحدة للصنف أكتر من كفاية"),
});

export type ItemUnitRow = {
  id: string;
  uomId: string;
  label: string;
  factor: number;
  isBase: boolean;
  barcode: string | null;
  /** True once a document line has been entered in this unit — then the factor is frozen. */
  inUse: boolean;
};

/** The units defined for one item, plus the org's unit list for the picker. */
export async function getItemUnitsAction(itemId: string): Promise<
  ActionState & { units?: ItemUnitRow[]; allUoms?: { id: string; label: string }[]; baseLabel?: string }
> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [item] = await db.select({ id: items.id, uomId: items.uomId }).from(items)
      .where(and(eq(items.id, itemId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!item) return { error: "الصنف غير موجود" };

    const [rows, allUoms] = await Promise.all([
      db.select({
        id: itemUnits.id, uomId: itemUnits.uomId, factor: itemUnits.factor,
        isBase: itemUnits.isBase, barcode: itemUnits.barcode, label: unitsOfMeasure.nameAr,
      }).from(itemUnits)
        .leftJoin(unitsOfMeasure, eq(unitsOfMeasure.id, itemUnits.uomId))
        .where(and(eq(itemUnits.itemId, itemId), eq(itemUnits.organizationId, auth.orgId)))
        .orderBy(asc(itemUnits.factor)),
      db.select({ id: unitsOfMeasure.id, label: unitsOfMeasure.nameAr }).from(unitsOfMeasure)
        .where(and(eq(unitsOfMeasure.organizationId, auth.orgId), eq(unitsOfMeasure.isActive, true)))
        .orderBy(asc(unitsOfMeasure.code)),
      ]);

    const used = await unitsInUse(auth.orgId, itemId);
    const baseLabel = allUoms.find((u) => u.id === item.uomId)?.label ?? "الوحدة الأساسية";

    return {
      ok: true,
      baseLabel,
      allUoms,
      units: rows.map((r) => ({
        id: r.id, uomId: r.uomId, label: r.label ?? "—",
        factor: Number(r.factor), isBase: r.isBase, barcode: r.barcode,
        inUse: used.has(r.uomId),
      })),
    };
  });
}

/**
 * Which of this item's units already appear on a document line. A unit in use keeps its
 * factor: editing "carton = 12" to 24 after five orders were entered in cartons would
 * silently restate every one of them.
 */
async function unitsInUse(orgId: string, itemId: string): Promise<Set<string>> {
  const tables = [purchaseOrderLines, purchaseReceiptLines, salesOrderLines, salesInvoiceLines, deliveryNoteLines] as const;
  const found = new Set<string>();
  for (const t of tables) {
    const rows = await db.selectDistinct({ uomId: t.uomId }).from(t)
      .where(and(eq(t.itemId, itemId), eq(t.organizationId, orgId)));
    for (const r of rows) if (r.uomId) found.add(r.uomId);
  }
  return found;
}

/**
 * Replace an item's unit set in one shot. The whole set is validated together — one
 * base at factor 1, no repeated unit, no shared barcode — because those rules are
 * about the set, not the row.
 */
export async function saveItemUnitsAction(input: z.input<typeof saveSchema>): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { itemId, units } = parsed.data;

  const setError = validateUnitSet(units);
  if (setError) return { error: setError };

  return withOrgScope(auth.orgId, false, async () => {
    const [item] = await db.select({ id: items.id, code: items.code, uomId: items.uomId }).from(items)
      .where(and(eq(items.id, itemId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!item) return { error: "الصنف غير موجود" };

    // The base row must be the item's own base unit, else "base" means two things.
    const base = units.find((u) => u.isBase);
    if (base && item.uomId && base.uomId !== item.uomId) {
      return { error: "الوحدة الأساسية لازم تكون نفس وحدة الصنف" };
    }

    const used = await unitsInUse(auth.orgId, itemId);
    const existing = await db.select({ uomId: itemUnits.uomId, factor: itemUnits.factor }).from(itemUnits)
      .where(and(eq(itemUnits.itemId, itemId), eq(itemUnits.organizationId, auth.orgId)));

    for (const old of existing) {
      if (!used.has(old.uomId)) continue;
      const next = units.find((u) => u.uomId === old.uomId);
      if (!next) return { error: "مش ممكن حذف وحدة مستخدمة في مستندات — عطّلها بدل ما تمسحها" };
      if (Math.abs(Number(next.factor) - Number(old.factor)) > 1e-9) {
        return { error: "مش ممكن تعديل معامل وحدة مستخدمة في مستندات — الكميات القديمة اتسجّلت بيه" };
      }
    }

    try {
      await db.transaction(async (tx) => {
        await tx.delete(itemUnits).where(and(eq(itemUnits.itemId, itemId), eq(itemUnits.organizationId, auth.orgId)));
        if (units.length) {
          await tx.insert(itemUnits).values(units.map((u) => ({
            organizationId: auth.orgId,
            itemId,
            uomId: u.uomId,
            factor: String(u.factor),
            isBase: u.isBase,
            barcode: u.barcode?.trim() || null,
          })));
        }
        await recordAudit(tx, {
          orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "ITEM",
          entityId: itemId, entityNumber: item.code,
          summary: `تحديث وحدات الصنف ${item.code} (${units.length} وحدة)`,
        });
      });
      revalidatePath(`/inventory/items/${encodeURIComponent(item.code)}`);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
    }
  });
}
