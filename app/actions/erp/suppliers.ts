"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq, like } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";


const schema = z.object({
  code: z.string().optional(),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  paymentTerms: z.coerce.number().int().min(0).default(30),
});

// Next auto code SUP-#### from the highest existing SUP-<n> for this org.
async function nextSupplierCode(orgId: string): Promise<string> {
  const rows = await db.select({ code: suppliers.code }).from(suppliers)
    .where(and(eq(suppliers.organizationId, orgId), like(suppliers.code, "SUP-%")));
  let max = 0;
  for (const r of rows) { const m = /^SUP-(\d+)$/.exec(r.code); if (m) max = Math.max(max, Number(m[1])); }
  return `SUP-${String(max + 1).padStart(4, "0")}`;
}

export async function saveSupplierAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = (formData.get("id") as string) || "";
  const auth = await authorizeErp(id ? "purchases.edit" : "purchases.create");
  if ("error" in auth) return auth;

  return withOrgScope(auth.orgId, false, async () => {
    const parsed = schema.safeParse({
      code: formData.get("code"),
      nameAr: formData.get("nameAr"),
      phone: formData.get("phone") || undefined,
      email: formData.get("email") || "",
      paymentTerms: formData.get("paymentTerms") || 30,
    });
    if (!parsed.success) return { error: parsed.error.issues[0].message };

    let code = (parsed.data.code ?? "").trim();
    const autoGen = !code;
    if (autoGen) {
      if (id) return { error: "الكود مطلوب" }; // only new suppliers auto-generate
      code = await nextSupplierCode(auth.orgId);
    }

    const data = {
      code,
      nameAr: parsed.data.nameAr,
      phone: parsed.data.phone || null,
      email: parsed.data.email || null,
      paymentTerms: parsed.data.paymentTerms,
    };

    const isUnique = (e: unknown) => e instanceof Error && e.message.includes("unique");
    try {
      if (id) {
        await db.update(suppliers).set(data).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.orgId)));
      } else {
        try {
          await db.insert(suppliers).values({ ...data, organizationId: auth.orgId });
        } catch (e) {
          // Auto-generated code collided with a concurrent insert — regenerate once.
          if (autoGen && isUnique(e)) await db.insert(suppliers).values({ ...data, code: await nextSupplierCode(auth.orgId), organizationId: auth.orgId });
          else throw e;
        }
      }
    } catch (e) {
      return { error: isUnique(e) ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
    }
    revalidatePath("/purchases/suppliers");
    revalidatePath("/purchases");
    return { ok: true };
  });
}

export async function deleteSupplierAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("purchases.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    try {
      await db.delete(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.orgId)));
    } catch {
      return { error: "تعذّر الحذف — قد يكون المورد مرتبطاً بفواتير" };
    }
    revalidatePath("/purchases/suppliers");
    revalidatePath("/purchases");
    return { ok: true };
  });
}

export async function bulkDeleteSuppliersAction(ids: string[]): Promise<BulkResult> {
  return bulkRun(ids, deleteSupplierAction);
}
