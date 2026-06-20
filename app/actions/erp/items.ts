"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { items } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  sellPrice: z.coerce.number().min(0).default(0),
  minStock: z.coerce.number().min(0).default(0),
});

export async function saveItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp(id ? "inventory.edit" : "inventory.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    sellPrice: formData.get("sellPrice") || 0,
    minStock: formData.get("minStock") || 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    code: parsed.data.code,
    nameAr: parsed.data.nameAr,
    sellPrice: String(parsed.data.sellPrice),
    minStock: String(parsed.data.minStock),
  };

  try {
    if (id) {
      await db.update(items).set(data).where(and(eq(items.id, id), eq(items.organizationId, auth.orgId)));
    } else {
      await db.insert(items).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
  revalidatePath("/erp/inventory");
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
  revalidatePath("/erp/inventory");
  return { ok: true };
}
