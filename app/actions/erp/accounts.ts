"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { accounts } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  nameEn: z.string().optional(),
  type: z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]),
  normalBalance: z.enum(["DEBIT", "CREDIT"]),
  parentId: z.string().optional(),
  isLeaf: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

export async function saveAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn") || undefined,
    type: formData.get("type"),
    normalBalance: formData.get("normalBalance"),
    parentId: formData.get("parentId") || undefined,
    isLeaf: formData.get("isLeaf") === "on",
    isActive: formData.get("isActive") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (id && parsed.data.parentId === id) return { error: "لا يمكن جعل الحساب أباً لنفسه" };

  const data = {
    code: parsed.data.code,
    nameAr: parsed.data.nameAr,
    nameEn: parsed.data.nameEn || null,
    type: parsed.data.type,
    normalBalance: parsed.data.normalBalance,
    parentId: parsed.data.parentId || null,
    isLeaf: parsed.data.isLeaf,
    isActive: parsed.data.isActive,
  };

  try {
    if (id) {
      await db.update(accounts).set(data).where(and(eq(accounts.id, id), eq(accounts.organizationId, auth.orgId)));
    } else {
      await db.insert(accounts).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
  revalidatePath("/erp/accounting");
  return { ok: true };
}

export async function deleteAccountAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("accounting.create");
  if ("error" in auth) return auth;
  try {
    await db.delete(accounts).where(and(eq(accounts.id, id), eq(accounts.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون الحساب مستخدماً في قيود" };
  }
  revalidatePath("/erp/accounting");
  return { ok: true };
}
