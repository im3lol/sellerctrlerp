"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { costCenters } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  nameEn: z.string().optional(),
  parentId: z.string().optional(),
  isActive: z.boolean().default(true),
});

export async function saveCostCenterAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn") || undefined,
    parentId: formData.get("parentId") || undefined,
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (id && parsed.data.parentId === id) return { error: "لا يمكن جعل المركز أباً لنفسه" };

  const data = {
    code: parsed.data.code,
    nameAr: parsed.data.nameAr,
    nameEn: parsed.data.nameEn || null,
    parentId: parsed.data.parentId || null,
    isActive: parsed.data.isActive,
  };

  try {
    if (id) {
      await db.update(costCenters).set(data).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, auth.orgId)));
    } else {
      await db.insert(costCenters).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
  revalidatePath("/erp/accounting/cost-centers");
  return { ok: true };
}

export async function deleteCostCenterAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  try {
    await db.delete(costCenters).where(and(eq(costCenters.id, id), eq(costCenters.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون المركز مستخدماً في قيود" };
  }
  revalidatePath("/erp/accounting/cost-centers");
  return { ok: true };
}
