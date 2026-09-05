"use server";

import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { binLocations, itemBins, items, warehouses } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { tryRecordAudit } from "@/lib/erp/audit";
import { validateBinCode, sortBins, locationsFor } from "@/lib/erp/bins";

/**
 * Bin locations and what lives in them. Nothing here touches stock: bins are where to
 * walk, not where the balance is. Deleting a bin loses its assignments and no quantity.
 */

const binSchema = z.object({
  id: z.string().optional(),
  warehouseId: z.string().min(1, "اختر المستودع"),
  code: z.string().trim().min(1, "كود الموقع مطلوب").max(32),
  nameAr: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function saveBinAction(input: z.input<typeof binSchema>): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

  const parsed = binSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  return withOrgScope(auth.orgId, false, async () => {
    const [wh] = await db.select({ id: warehouses.id }).from(warehouses)
      .where(and(eq(warehouses.id, d.warehouseId), eq(warehouses.organizationId, auth.orgId))).limit(1);
    if (!wh) return { error: "المستودع غير موجود" };

    const siblings = await db.select({ id: binLocations.id, code: binLocations.code }).from(binLocations)
      .where(and(eq(binLocations.organizationId, auth.orgId), eq(binLocations.warehouseId, d.warehouseId)));
    const codeErr = validateBinCode(d.code, siblings.filter((s) => s.id !== d.id).map((s) => s.code));
    if (codeErr) return { error: codeErr };

    const values = {
      organizationId: auth.orgId, warehouseId: d.warehouseId, code: d.code.trim(),
      nameAr: d.nameAr?.trim() || null, notes: d.notes?.trim() || null,
      isActive: d.isActive, updatedAt: new Date(),
    };

    if (d.id) {
      const done = await db.update(binLocations).set(values)
        .where(and(eq(binLocations.id, d.id), eq(binLocations.organizationId, auth.orgId)))
        .returning({ id: binLocations.id });
      if (!done.length) return { error: "الموقع غير موجود" };
    } else {
      await db.insert(binLocations).values(values);
    }

    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: d.id ? "UPDATE" : "CREATE",
      entityType: "BIN_LOCATION", entityId: d.id ?? "new", entityNumber: d.code,
      summary: `${d.id ? "تعديل" : "إضافة"} موقع تخزين ${d.code}`,
    });
    revalidatePath("/inventory/bins");
    return { ok: true };
  });
}

export async function deleteBinAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [bin] = await db.select({ code: binLocations.code }).from(binLocations)
      .where(and(eq(binLocations.id, id), eq(binLocations.organizationId, auth.orgId))).limit(1);
    if (!bin) return { error: "الموقع غير موجود" };

    // The assignments go with it (cascade). No stock moves — a bin holds no balance.
    await db.delete(binLocations).where(and(eq(binLocations.id, id), eq(binLocations.organizationId, auth.orgId)));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "BIN_LOCATION",
      entityId: id, entityNumber: bin.code, summary: `حذف موقع تخزين ${bin.code}`,
    });
    revalidatePath("/inventory/bins");
    return { ok: true };
  });
}

/** Put an item in a bin, or move which bin is its primary. */
export async function assignItemBinAction(input: { itemId: string; binId: string; isPrimary: boolean }): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [bin] = await db.select({ id: binLocations.id, warehouseId: binLocations.warehouseId })
      .from(binLocations)
      .where(and(eq(binLocations.id, input.binId), eq(binLocations.organizationId, auth.orgId))).limit(1);
    if (!bin) return { error: "الموقع غير موجود" };

    const [item] = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.id, input.itemId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!item) return { error: "الصنف غير موجود" };

    await db.transaction(async (tx) => {
      // One primary per (item, warehouse) — two "walk here first" answers is none.
      if (input.isPrimary) {
        await tx.update(itemBins).set({ isPrimary: false })
          .where(and(
            eq(itemBins.organizationId, auth.orgId),
            eq(itemBins.itemId, input.itemId),
            eq(itemBins.warehouseId, bin.warehouseId),
          ));
      }
      await tx.insert(itemBins)
        .values({
          organizationId: auth.orgId, itemId: input.itemId,
          warehouseId: bin.warehouseId, binId: input.binId, isPrimary: input.isPrimary,
        })
        .onConflictDoUpdate({
          target: [itemBins.itemId, itemBins.binId],
          set: { isPrimary: input.isPrimary, updatedAt: new Date() },
        });
    });

    revalidatePath("/inventory/bins");
    return { ok: true };
  });
}

export async function unassignItemBinAction(itemId: string, binId: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.delete(itemBins).where(and(
      eq(itemBins.organizationId, auth.orgId),
      eq(itemBins.itemId, itemId),
      eq(itemBins.binId, binId),
    ));
    revalidatePath("/inventory/bins");
    return { ok: true };
  });
}

export type BinRow = {
  id: string; code: string; nameAr: string | null; warehouseId: string; warehouseName: string;
  isActive: boolean; itemCount: number;
};

/** Bins for one warehouse (or all), in walking order. */
export async function listBinsAction(warehouseId?: string): Promise<ActionState & { bins?: BinRow[] }> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        id: binLocations.id, code: binLocations.code, nameAr: binLocations.nameAr,
        warehouseId: binLocations.warehouseId, isActive: binLocations.isActive,
        warehouseName: warehouses.nameAr,
      })
      .from(binLocations)
      .leftJoin(warehouses, eq(warehouses.id, binLocations.warehouseId))
      .where(warehouseId
        ? and(eq(binLocations.organizationId, auth.orgId), eq(binLocations.warehouseId, warehouseId))
        : eq(binLocations.organizationId, auth.orgId))
      .orderBy(asc(binLocations.code));

    const counts = rows.length
      ? await db.select({ binId: itemBins.binId }).from(itemBins)
          .where(and(eq(itemBins.organizationId, auth.orgId), inArray(itemBins.binId, rows.map((r) => r.id))))
      : [];

    const bins = sortBins(rows.map((r) => ({
      ...r,
      warehouseName: r.warehouseName ?? "—",
      itemCount: counts.filter((c) => c.binId === r.id).length,
    })));
    return { ok: true, bins };
  });
}

/** Where one item can be found, best first. */
export async function getItemLocationsAction(itemId: string): Promise<
  ActionState & { locations?: { binId: string; code: string; nameAr: string | null; warehouseName: string; isPrimary: boolean }[] }
> {
  const auth = await authorizeErp("inventory.view");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const rows = await db
      .select({
        binId: itemBins.binId, isPrimary: itemBins.isPrimary,
        code: binLocations.code, nameAr: binLocations.nameAr, warehouseName: warehouses.nameAr,
      })
      .from(itemBins)
      .leftJoin(binLocations, eq(binLocations.id, itemBins.binId))
      .leftJoin(warehouses, eq(warehouses.id, itemBins.warehouseId))
      .where(and(eq(itemBins.organizationId, auth.orgId), eq(itemBins.itemId, itemId)));

    const bins = rows.map((r) => ({ id: r.binId, code: r.code ?? "—", nameAr: r.nameAr }));
    const ordered = locationsFor(rows.map((r) => ({ binId: r.binId, isPrimary: r.isPrimary })), bins);

    return {
      ok: true,
      locations: ordered.map((b) => {
        const src = rows.find((r) => r.binId === b.id)!;
        return {
          binId: b.id, code: b.code, nameAr: b.nameAr ?? null,
          warehouseName: src.warehouseName ?? "—", isPrimary: src.isPrimary,
        };
      }),
    };
  });
}
