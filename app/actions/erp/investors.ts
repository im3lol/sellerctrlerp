"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { investors } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const schema = z.object({
  code: z.string().min(1, "الكود مطلوب"),
  fullName: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  nationalId: z.string().optional(),
  status: z.enum(["active", "inactive"]).default("active"),
});

export async function saveInvestorAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp(id ? "investors.edit" : "investors.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    code: formData.get("code"),
    fullName: formData.get("fullName"),
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || "",
    nationalId: formData.get("nationalId") || undefined,
    status: formData.get("status") || "active",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const data = {
    code: parsed.data.code,
    fullName: parsed.data.fullName,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    nationalId: parsed.data.nationalId || null,
    status: parsed.data.status,
  };

  try {
    if (id) {
      await db.update(investors).set(data).where(and(eq(investors.id, id), eq(investors.organizationId, auth.orgId)));
    } else {
      await db.insert(investors).values({ ...data, organizationId: auth.orgId });
    }
  } catch (e) {
    return { error: e instanceof Error && e.message.includes("unique") ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
  }
  revalidatePath("/erp/investors");
  return { ok: true };
}

export async function deleteInvestorAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("investors.delete");
  if ("error" in auth) return auth;
  try {
    await db.delete(investors).where(and(eq(investors.id, id), eq(investors.organizationId, auth.orgId)));
  } catch {
    return { error: "تعذّر الحذف — قد يكون المستثمر مرتبطاً بحركات" };
  }
  revalidatePath("/erp/investors");
  return { ok: true };
}
