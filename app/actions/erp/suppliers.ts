"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { suppliers } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type SaveSupplierState = ActionState & { created?: { id: string; nameAr: string } };
import { bulkRun, type BulkResult } from "@/lib/erp/bulk-delete";
import { nextCode } from "@/lib/erp/next-code";


const schema = z.object({
  code: z.string().optional(),
  nameAr: z.string().min(2, "الاسم قصير جداً"),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صحيح").optional().or(z.literal("")),
  paymentTerms: z.coerce.number().int().min(0).default(30),
});

// Next auto code SUP-#### — the max is computed in the database, not by pulling every
// code into JS (see lib/erp/next-code.ts).
const nextSupplierCode = (orgId: string) =>
  nextCode({ table: suppliers, orgCol: suppliers.organizationId, codeCol: suppliers.code, orgId, prefix: "SUP", pad: 4 });

export async function saveSupplierAction(_prev: SaveSupplierState, formData: FormData): Promise<SaveSupplierState> {
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
    // Returned on create so the quick-create popover can select the new supplier without
    // a round trip through the page's server-rendered list.
    let created: { id: string; nameAr: string } | undefined;
    try {
      if (id) {
        await db.update(suppliers).set(data).where(and(eq(suppliers.id, id), eq(suppliers.organizationId, auth.orgId)));
      } else {
        try {
          [created] = await db.insert(suppliers).values({ ...data, organizationId: auth.orgId }).returning({ id: suppliers.id, nameAr: suppliers.nameAr });
        } catch (e) {
          // Auto-generated code collided with a concurrent insert — regenerate once.
          if (autoGen && isUnique(e)) [created] = await db.insert(suppliers).values({ ...data, code: await nextSupplierCode(auth.orgId), organizationId: auth.orgId }).returning({ id: suppliers.id, nameAr: suppliers.nameAr });
          else throw e;
        }
      }
    } catch (e) {
      return { error: isUnique(e) ? "الكود مستخدم مسبقاً" : "تعذّر الحفظ" };
    }
    revalidatePath("/purchases/suppliers");
    revalidatePath("/purchases");
    return { ok: true, created };
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
