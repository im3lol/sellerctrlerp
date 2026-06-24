"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { organizations, accountingConfigurations } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };

const profileSchema = z.object({
  nameAr: z.string().min(2, "اسم المنشأة قصير جداً"),
  nameEn: z.string().optional(),
  legalName: z.string().optional(),
  taxNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صالح").optional().or(z.literal("")),
  vatRate: z.coerce.number().min(0, "نسبة غير صالحة").max(100, "نسبة غير صالحة"),
  fiscalYearStart: z.string().optional(),
});

export async function saveOrgProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  const parsed = profileSchema.safeParse({
    nameAr: formData.get("nameAr"),
    nameEn: formData.get("nameEn") || undefined,
    legalName: formData.get("legalName") || undefined,
    taxNumber: formData.get("taxNumber") || undefined,
    address: formData.get("address") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || "",
    vatRate: formData.get("vatRate"),
    fiscalYearStart: formData.get("fiscalYearStart") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  try {
    await db.update(organizations).set({
      nameAr: d.nameAr,
      nameEn: d.nameEn || "My Company",
      legalName: d.legalName || null,
      taxNumber: d.taxNumber || null,
      address: d.address || null,
      phone: d.phone || null,
      email: d.email || null,
      vatRate: String(d.vatRate),
      fiscalYearStart: d.fiscalYearStart || null,
      updatedAt: new Date(),
    }).where(eq(organizations.id, auth.orgId));
  } catch {
    return { error: "تعذّر حفظ بيانات المنشأة" };
  }
  revalidatePath("/erp/settings");
  return { ok: true };
}

const CONFIG_FIELDS = [
  "receivableAccountId", "payableAccountId", "cashAccountId", "bankAccountId",
  "salesAccountId", "purchaseAccountId", "outputTaxAccountId", "inputTaxAccountId",
  "inventoryAccountId", "cogsAccountId",
] as const;

export async function saveAccountingConfigAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  const values = Object.fromEntries(
    CONFIG_FIELDS.map((f) => [f, (formData.get(f) as string) || null]),
  ) as Record<(typeof CONFIG_FIELDS)[number], string | null>;

  try {
    const [existing] = await db
      .select({ id: accountingConfigurations.id })
      .from(accountingConfigurations)
      .where(eq(accountingConfigurations.organizationId, auth.orgId))
      .limit(1);
    if (existing) {
      await db.update(accountingConfigurations)
        .set({ ...values, updatedAt: new Date() })
        .where(and(eq(accountingConfigurations.id, existing.id), eq(accountingConfigurations.organizationId, auth.orgId)));
    } else {
      await db.insert(accountingConfigurations).values({ organizationId: auth.orgId, ...values });
    }
  } catch {
    return { error: "تعذّر حفظ الضبط المحاسبي" };
  }
  revalidatePath("/erp/settings");
  return { ok: true };
}
