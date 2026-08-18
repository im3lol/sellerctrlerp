"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { customers, users } from "@/db/schema";
import { authorizeErp } from "@/lib/erp/action-auth";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";
import { nextCode } from "@/lib/erp/next-code";

export type ActionState = { error?: string; ok?: boolean };

const schema = z.object({
  code: z.string().optional(),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  creditLimit: z.coerce.number().min(0).default(0),
  paymentTerms: z.coerce.number().int().min(0).default(30),
});

// Next auto code CUST-#### — max computed in the database (see lib/erp/next-code.ts).
const nextCustomerCode = (orgId: string) =>
  nextCode({ table: customers, orgCol: customers.organizationId, codeCol: customers.code, orgId, prefix: "CUST", pad: 4 });

export async function saveCustomerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp(id ? "sales.edit" : "sales.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse({
      code: formData.get("code"),
      nameAr: formData.get("nameAr"),
      phone: formData.get("phone") || undefined,
      email: formData.get("email") || "",
      creditLimit: formData.get("creditLimit") || 0,
      paymentTerms: formData.get("paymentTerms") || 30,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    let code = (parsed.data.code ?? "").trim();
    const autoGen = !code;
    if (autoGen) {
      if (id) return { error: "الكود مطلوب" }; // only new customers auto-generate
      code = await nextCustomerCode(auth.orgId);
    }

    const data = {
      code,
      nameAr: parsed.data.nameAr,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      creditLimit: String(parsed.data.creditLimit),
      paymentTerms: parsed.data.paymentTerms,
    };

    const isUnique = (e: unknown) => e instanceof Error && e.message.includes("unique");
    try {
      if (id) {
        await db.update(customers).set(data).where(and(eq(customers.id, id), eq(customers.organizationId, auth.orgId)));
      } else {
        try {
          await db.insert(customers).values({ ...data, organizationId: auth.orgId });
        } catch (e) {
          // Auto-generated code collided with a concurrent insert — regenerate once.
          if (autoGen && isUnique(e)) await db.insert(customers).values({ ...data, code: await nextCustomerCode(auth.orgId), organizationId: auth.orgId });
          else throw e;
        }
      }
    } catch (e) {
      return { error: isUnique(e) ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
    }

    revalidatePath("/sales/customers");
    revalidatePath("/sales");
    return { ok: true };
  });
}

export async function linkCustomerPortalUserAction(input: {
  customerId: string;
  email: string;
}): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const [cust] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, input.customerId), eq(customers.organizationId, auth.orgId)))
      .limit(1);
    if (!cust) return { error: "العميل غير موجود" };

    if (!input.email) {
      await db.update(customers).set({ portalUserId: null, updatedAt: new Date() }).where(eq(customers.id, input.customerId));
      revalidatePath("/sales/customers");
      revalidatePath("/sales");
      return { ok: true };
    }

    const [usr] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, input.email)).limit(1);
    if (!usr) return { error: "لا يوجد مستخدم بهذا البريد الإلكتروني" };
    if (usr.role !== "client") return { error: "المستخدم ليس بدور العميل (client)" };

    await db.update(customers).set({ portalUserId: usr.id, updatedAt: new Date() }).where(eq(customers.id, input.customerId));
    revalidatePath("/sales/customers");
    revalidatePath("/sales");
    return { ok: true };
  });
}

export async function deleteCustomerAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.delete(customers).where(and(eq(customers.id, id), eq(customers.organizationId, auth.orgId)));
    } catch {
      return { error: "تعذّر الحذف — قد يكون العميل مرتبطاً بفواتير" };
    }
    revalidatePath("/sales/customers");
    revalidatePath("/sales");
    return { ok: true };
  });
}

export async function bulkDeleteCustomersAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteCustomerAction);
}
