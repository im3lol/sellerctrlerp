"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { organizations, accountingConfigurations } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { putObject, publicUrl } from "@/lib/storage";


const profileSchema = z.object({
  nameAr: z.string().min(2, "اسم المنشأة قصير جداً"),
  nameEn: z.string().optional(),
  legalName: z.string().optional(),
  taxNumber: z.string().optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("بريد غير صالح").optional().or(z.literal("")),
  // Printed on every document header. Empty = the header falls back to an initials tile.
  logo: z.string().optional(),
  vatRate: z.coerce.number().min(0, "نسبة غير صالحة").max(100, "نسبة غير صالحة"),
  poApprovalThreshold: z.coerce.number().min(0, "قيمة غير صالحة").default(0),
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
    logo: formData.get("logo") || undefined,
    vatRate: formData.get("vatRate"),
    poApprovalThreshold: formData.get("poApprovalThreshold") ?? 0,
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
      logo: d.logo || null,
      vatRate: String(d.vatRate),
      poApprovalThreshold: String(d.poApprovalThreshold),
      fiscalYearStart: d.fiscalYearStart || null,
      updatedAt: new Date(),
    }).where(eq(organizations.id, auth.orgId));
  } catch {
    return { error: "تعذّر حفظ بيانات المنشأة" };
  }
  revalidatePath("/erp/settings");
  return { ok: true };
}

/**
 * Uploads the company logo that heads every printed document.
 *
 * Mirrors uploadItemImageAction (app/actions/erp/items.ts) — same storage helpers,
 * same guards — but keyed under `org/<orgId>/` and gated on settings.edit rather than
 * inventory.create.
 *
 * Returns the URL; the form puts it in a hidden field and the profile save persists
 * it, so an upload that's never saved leaves the record untouched.
 */
export async function uploadOrgLogoAction(
  formData: FormData,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return { ok: false, error: auth.error };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "لم يتم اختيار صورة" };
  if (!file.type.startsWith("image/")) return { ok: false, error: "الملف ليس صورة" };
  if (file.size > 2 * 1024 * 1024) return { ok: false, error: "حجم الشعار يتجاوز 2MB" };

  const safe = file.name.replace(/[^\w.\-]+/g, "_");
  const key = `org/${auth.orgId}/logo-${Date.now()}-${safe}`;
  try {
    await putObject(key, Buffer.from(await file.arrayBuffer()), file.type);
  } catch {
    return { ok: false, error: "تعذّر رفع الشعار" };
  }
  return { ok: true, url: publicUrl(key) };
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
