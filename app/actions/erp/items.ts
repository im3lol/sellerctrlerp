"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { items, itemCodes } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { putObject, publicUrl } from "@/lib/storage";

export type { ActionState };

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
