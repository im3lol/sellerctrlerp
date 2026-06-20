"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  paymentTerms: z.coerce.number().int().min(0).default(30),
});

export async function saveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp(id ? "purchases.edit" : "purchases.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || "",
    paymentTerms: formData.get("paymentTerms") || 30,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    code: parsed.data.code,
    nameAr: parsed.data.nameAr,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    paymentTerms: parsed.data.paymentTerms,
  };

  try {
    if (id) {
      await db.update(suppliers).set(data).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.orgId)));
    } else {
      await db.insert(suppliers).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
  revalidatePath("/erp/purchases");
  return { ok: true };
}

export async function deleteSupplierAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.edit");
  if ("error" in auth) return auth;
  try {
    await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون المورد مرتبطاً بفواتير" };
  }
  revalidatePath("/erp/purchases");
  return { ok: true };
}
