"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { customers } from "@/db/schema";
import { getActiveOrg } from "@/lib/erp/org";
import { getErpRole } from "@/lib/erp/auth-guard";
import { erpRoleHasPermission, type ErpPermission } from "@/lib/erp/permissions";

export type ActionState = { error?: string; ok?: boolean };

/** Resolve the active org and enforce an ERP permission for a server action. */
async function authorize(permission: ErpPermission): Promise<{ orgId: string } | { error: string }> {
  const { user, org } = await getActiveOrg();
  if (!user) return { error: "غير مصرح بالدخول" };
  if (!org) return { error: "لم يتم تحديد المؤسسة" };
  const role = await getErpRole(org.id, user);
  if (!role) return { error: "غير مصرح بالوصول إلى هذه المؤسسة" };
  if (role !== "super_admin" && !erpRoleHasPermission(role, permission)) {
    return { error: "ليس لديك صلاحية لهذا الإجراء" };
  }
  return { orgId: org.id };
}

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  creditLimit: z.coerce.number().min(0).default(0),
  paymentTerms: z.coerce.number().int().min(0).default(30),
});

export async function saveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorize(id ? "sales.edit" : "sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    nameAr: formData.get("nameAr"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || "",
    creditLimit: formData.get("creditLimit") || 0,
    paymentTerms: formData.get("paymentTerms") || 30,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    code: parsed.data.code,
    nameAr: parsed.data.nameAr,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    creditLimit: String(parsed.data.creditLimit),
    paymentTerms: parsed.data.paymentTerms,
  };

  try {
    if (id) {
      await db.update(customers).set(data).where(and(eq(customers.id, id), eq(customers.organizationId, auth.orgId)));
    } else {
      await db.insert(customers).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    const msg = e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ";
    return { error: msg };
  }

  revalidatePath("/erp/sales");
  return { ok: true };
}

export async function deleteCustomerAction(id: string): Promise<ActionState> {
  const auth = await authorize("sales.edit");
  if ("error" in auth) return auth;
  try {
    await db.delete(customers).where(and(eq(customers.id, id), eq(customers.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون العميل مرتبطاً بفواتير" };
  }
  revalidatePath("/erp/sales");
  return { ok: true };
}
