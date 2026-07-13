"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { validateParentLink } from "@/lib/erp/item-family-core";
import { putObject, publicUrl } from "@/lib/storage";


const normalizeCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

const codeSchema = z.object({
  codeType: z.string().min(1),
  code: z.string().min(1),
});
const schema = z.object({
  id: z.string().optional(),
  code: z.string().min(1, "الكود الداخلي مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  nameEn: z.string().optional(),
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

  // Dedup codes by normalized value within this item.
  const seen = new Set<string>();
  const codes = d.codes
    .map((c) => ({ codeType: c.codeType, code: c.code.trim(), normalizedCode: normalizeCode(c.code) }))
    .filter((c) => c.code && c.normalizedCode && !seen.has(c.normalizedCode) && seen.add(c.normalizedCode));

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
    nameEn: d.nameEn?.trim() || null,
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
          itemId: id!, organizationId: auth.orgId, codeType: c.codeType, code: c.code, normalizedCode: c.normalizedCode,
        })));
      }
      return id!;
    });
    revalidatePath("/erp/inventory");
    revalidatePath("/erp/inventory/items");
    revalidatePath(`/erp/inventory/items/${itemId}`);
    return { ok: true, id: itemId };
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
}

/**
 * Link an item as a variation under a parent, or unlink it (parentId = null).
 * Used by the family manager on the item detail page. Same one-level guard as the
 * form path. Pure metadata — no GL/stock effect.
 */
export async function setItemParentAction(childId: string, parentId: string | null, variationValue?: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.edit");
  if ("error" in auth) return auth;

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
  revalidatePath("/erp/inventory/items");
  revalidatePath(`/erp/inventory/items/${childId}`);
  if (parentId) revalidatePath(`/erp/inventory/items/${parentId}`);
  return { ok: true };
}

export async function deleteItemAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("inventory.delete");
  if ("error" in auth) return auth;
  try {
    await db.delete(items).where(and(eq(items.id, id), eq(items.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون الصنف مرتبطاً بحركات" };
  }
  revalidatePath("/erp/inventory/items");
  return { ok: true };
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
