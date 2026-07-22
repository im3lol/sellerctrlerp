"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, or, ilike, inArray, isNull, notInArray } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { validateParentLink } from "@/lib/erp/item-family-core";
import { prepareCodes, normalizeCode } from "@/lib/erp/item-codes";
import { putObject, publicUrl } from "@/lib/storage";

const codeSchema = z.object({
  codeType: z.string().min(1),
  code: z.string().min(1),
});
const schema = z.object({
  id: z.string().optional(),
  code: z.string().min(1, "الكود الداخلي مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  description: z.string().optional(),
  sellPrice: z.coerce.number().min(0).default(0),
  minStock: z.coerce.number().min(0).default(0),
  isPerishable: z.coerce.boolean().default(false),
  shelfLifeDays: z.coerce.number().int().min(0).optional(),
  image: z.string().optional(),
  brand: z.string().optional(),
  weight: z.string().optional(),
  dimensions: z.string().optional(),
  parentItemId: z.string().optional(), // variation family: link this item under a parent
  variationValue: z.string().optional(), // the child's variation label (e.g. "أحمر - L")
  codes: z.array(codeSchema).default([]),
});

/** Create or update an item with its description, image, and external codes. */
export async function saveItemAction(input: unknown): Promise<ActionState & { id?: string }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const auth = await authorizeErp(d.id ? "inventory.edit" : "inventory.create");
  if ("error" in auth) return auth;

  // Dedup + flag the primary (the code the barcode label prints). Nothing here ever
  // set isPrimary, so a barcode typed into the form was silently ignored and every
  // label fell back to the internal item code. See prepareCodes.
  return withOrgScope(auth.orgId, false, async () => {
    const codes = prepareCodes(d.codes);

    // Variation family: validate the parent link (one level, no cycles, same org).
    const rawParent = d.parentItemId?.trim() || "";
    let parentItemId: string | null = null;
    let variationValue: string | null = null;
    if (rawParent && rawParent !== d.id) {
      const [parent] = await db.select({ id: items.id, parentItemId: items.parentItemId }).from(items)
        .where(and(eq(items.id, rawParent), eq(items.organizationId, auth.orgId))).limit(1);
      let childHasChildren = false;
      if (d.id) {
        const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(items)
          .where(and(eq(items.organizationId, auth.orgId), eq(items.parentItemId, d.id)));
        childHasChildren = Number(c?.n ?? 0) > 0;
      }
      const err = validateParentLink({
        childId: d.id ?? "__new__", parentId: rawParent,
        parentExists: !!parent, parentHasParent: !!parent?.parentItemId, childHasChildren,
      });
      if (err) return { error: err };
      parentItemId = rawParent;
      variationValue = d.variationValue?.trim() || null;
    }

    const data = {
      code: d.code.trim(),
      nameAr: d.nameAr.trim(),
      description: d.description?.trim() || null,
      sellPrice: String(d.sellPrice),
      minStock: String(d.minStock),
      isPerishable: d.isPerishable,
      shelfLifeDays: d.isPerishable ? (d.shelfLifeDays ?? null) : null,
      image: d.image?.trim() || null,
      brand: d.brand?.trim() || null,
      weight: d.weight?.trim() || null,
      dimensions: d.dimensions?.trim() || null,
      parentItemId,
      variationValue,
    };

    try {
      const itemId = await db.transaction(async (tx) => {
        let id = d.id;
        if (id) {
          await tx.update(items).set(data).where(and(eq(items.id, id), eq(items.organizationId, auth.orgId)));
        } else {
          const [row] = await tx.insert(items).values({ ...data, organizationId: auth.orgId }).returning({ id: items.id });
          id = row.id;
        }
        // Replace the item's external codes.
        await tx.delete(itemCodes).where(eq(itemCodes.itemId, id!));
        if (codes.length) {
          await tx.insert(itemCodes).values(codes.map((c) => ({
            itemId: id!, organizationId: auth.orgId, codeType: c.codeType, code: c.code,
            normalizedCode: c.normalizedCode, isPrimary: c.isPrimary,
          })));
        }
        return id!;
      });
      revalidatePath("/inventory");
      revalidatePath("/inventory/items");
      revalidatePath(`/inventory/items/${itemId}`);
      return { ok: true, id: itemId };
    } catch (e) {
      return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
    }
  });
}

/**
 * Link an item as a variation under a parent, or unlink it (parentId = null).
 * Used by the family manager on the item detail page. Same one-level guard as the
 * form path. Pure metadata — no GL/stock effect.
 */
export async function setItemParentAction(childId: string, parentId: string | null, variationValue?: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [child] = await db.select({ id: items.id }).from(items)
      .where(and(eq(items.id, childId), eq(items.organizationId, auth.orgId))).limit(1);
    if (!child) return { error: "الصنف غير موجود" };

    if (parentId) {
      const [parent] = await db.select({ id: items.id, parentItemId: items.parentItemId }).from(items)
        .where(and(eq(items.id, parentId), eq(items.organizationId, auth.orgId))).limit(1);
      const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(items)
        .where(and(eq(items.organizationId, auth.orgId), eq(items.parentItemId, childId)));
      const err = validateParentLink({
        childId, parentId,
        parentExists: !!parent, parentHasParent: !!parent?.parentItemId, childHasChildren: Number(c?.n ?? 0) > 0,
      });
      if (err) return { error: err };
    }

    await db.update(items)
      .set({ parentItemId: parentId, variationValue: parentId ? (variationValue?.trim() || null) : null })
      .where(and(eq(items.id, childId), eq(items.organizationId, auth.orgId)));
    revalidatePath("/inventory/items");
    revalidatePath(`/inventory/items/${childId}`);
    if (parentId) revalidatePath(`/inventory/items/${parentId}`);
    return { ok: true };
  });
}

export async function deleteItemAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.delete");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.delete(items).where(and(eq(items.id, id), eq(items.organizationId, auth.orgId)));
    } catch {
      return { error: "تعذّر الحذف — قد يكون الصنف مرتبطاً بحركات" };
    }
    revalidatePath("/inventory/items");
    return { ok: true };
  });
}

export type ItemsFilter = { q?: string; status?: string; category?: string; missing?: string };

/** Item ids matching the list filter (base conditions — no family expansion). */
async function matchingItemIds(orgId: string, f: ItemsFilter): Promise<string[]> {
  const conds = [eq(items.organizationId, orgId)];
  const q = (f.q ?? "").trim();
  if (q) {
    const norm = normalizeCode(q);
    const codeItemIds = norm
      ? (await db.select({ id: itemCodes.itemId }).from(itemCodes)
          .where(and(eq(itemCodes.organizationId, orgId), ilike(itemCodes.normalizedCode, `%${norm}%`)))).map((r) => r.id)
      : [];
    const search = [ilike(items.code, `%${q}%`), ilike(items.nameAr, `%${q}%`)];
    if (codeItemIds.length) search.push(inArray(items.id, [...new Set(codeItemIds)]));
    conds.push(or(...search)!);
  }
  if (f.status === "active") conds.push(eq(items.isActive, true));
  if (f.status === "inactive") conds.push(eq(items.isActive, false));
  if (f.category) conds.push(eq(items.categoryId, f.category));
  if (f.missing === "image") conds.push(isNull(items.image));
  if (f.missing === "codes") {
    const withCodes = [...new Set((await db.select({ id: itemCodes.itemId }).from(itemCodes)
      .where(eq(itemCodes.organizationId, orgId))).map((r) => r.id))];
    if (withCodes.length) conds.push(notInArray(items.id, withCodes));
  }
  return (await db.select({ id: items.id }).from(items).where(and(...conds))).map((r) => r.id);
}

/**
 * Bulk-delete items — by explicit ids, or every item matching a filter (for
 * "select all across pages"). Items referenced by movements/orders can't be
 * deleted (FK); those are skipped and reported as blocked rather than failing
 * the whole batch.
 */
export async function bulkDeleteItemsAction(input: { ids?: string[]; all?: ItemsFilter }): Promise<{ ok: true; deleted: number; blocked: number } | { ok: false; error: string }> {
  const auth = await authorizeErp("inventory.delete");
  if ("error" in auth) return { ok: false, error: auth.error };

  return withOrgScope(auth.orgId, false, async () => {
    let ids: string[];
    if (input.ids?.length) {
      ids = (await db.select({ id: items.id }).from(items)
        .where(and(eq(items.organizationId, auth.orgId), inArray(items.id, input.ids)))).map((r) => r.id);
    } else if (input.all) {
      ids = await matchingItemIds(auth.orgId, input.all);
    } else {
      return { ok: false, error: "لم تحدّد أصنافًا" };
    }
    if (!ids.length) return { ok: false, error: "لا توجد أصناف للحذف" };

    let deleted = 0, blocked = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      try {
        const res = await db.delete(items).where(and(eq(items.organizationId, auth.orgId), inArray(items.id, chunk))).returning({ id: items.id });
        deleted += res.length;
      } catch {
        // A referenced item aborts the chunk's transaction — retry per item to
        // delete the deletable ones and skip the blocked (referenced) ones.
        for (const id of chunk) {
          try {
            const r = await db.delete(items).where(and(eq(items.organizationId, auth.orgId), eq(items.id, id))).returning({ id: items.id });
            if (r.length) deleted++; else blocked++;
          } catch { blocked++; }
        }
      }
    }
    revalidatePath("/inventory/items");
    return { ok: true, deleted, blocked };
  });
}

/** Upload an item image to object storage; returns its public URL. */
export async function uploadItemImageAction(formData: FormData): Promise<{ ok: boolean; url?: string; error?: string }> {
  const auth = await authorizeErp("inventory.create");
  if ("error" in auth) return { ok: false, error: "error" in auth ? auth.error : "غير مصرّح" };
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "لم يتم اختيار صورة" };
  if (!file.type.startsWith("image/")) return { ok: false, error: "الملف ليس صورة" };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "حجم الصورة يتجاوز 5MB" };

  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const key = `items/${auth.orgId}/${Date.now()}-${safe}`;
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return { ok: false, error: "تعذّر رفع الصورة" };
  }
  return { ok: true, url: publicUrl(key) };
}
