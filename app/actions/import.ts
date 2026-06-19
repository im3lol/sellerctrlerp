"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { products, productBases, productStatuses, workspaces } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import { parseProductsBuffer } from "@/lib/excel";
import { recordActivity } from "@/lib/activity";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

export type ImportResult = { ok: boolean; imported?: number; skipped?: number; error?: string };

async function defaultStatusId(): Promise<string | null> {
  const [s] = await db
    .select({ id: productStatuses.id })
    .from(productStatuses)
    .where(and(isNull(productStatuses.workspaceId), eq(productStatuses.isDefault, true)))
    .limit(1);
  return s?.id ?? null;
}

/** Import products from an uploaded Excel file into a workspace. */
export async function importProductsAction(
  workspaceId: string,
  formData: FormData,
): Promise<ImportResult> {
  const user = await requireUser();
  if (!can(user.role, "product.edit") || !(await canAccessWorkspace(user, workspaceId))) {
    return { ok: false, error: "غير مصرّح" };
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "لم يتم اختيار ملف" };
  if (!/\.(xlsx|xls)$/i.test(file.name)) return { ok: false, error: "الملف يجب أن يكون Excel (.xlsx)" };

  let rows;
  try {
    rows = parseProductsBuffer(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { ok: false, error: "تعذّر قراءة الملف" };
  }
  if (rows.length === 0) return { ok: false, error: "لا توجد صفوف صالحة (تأكد من عمود «اسم المنتج»)" };

  // Draft mode: products with incomplete data are saved hidden from employees
  // until a manager completes the data and confirms (publishes) them.
  const draft = formData.get("draft") === "1" || formData.get("draft") === "true";

  const statusId = await defaultStatusId();
  const stamp = Date.now();
  let imported = 0;

  const [ws] = await db.select({ clientUserId: workspaces.clientUserId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);

  // Each imported row → one shared base catalog item + one platform listing.
  const baseValues = rows.map((r, i) => ({
    clientUserId: ws?.clientUserId ?? null,
    name: r.name ?? `منتج ${i + 1}`,
    brand: r.brand ?? null,
    description: r.description ?? null,
    sizes: r.sizes ?? null,
    features: r.features ?? null,
    imageUrl: r.imageUrl ?? null,
    galleryUrl: r.galleryUrl ?? null,
    productUrl: r.productUrl ?? null,
    price: r.price ? r.price.replace(/[^\d.]/g, "") || null : null,
    createdById: user.id,
  }));

  // Insert bases in chunks (returning ids in insertion order), then the listings.
  for (let i = 0; i < baseValues.length; i += 100) {
    const baseChunk = baseValues.slice(i, i + 100);
    const baseIds = await db.insert(productBases).values(baseChunk).returning({ id: productBases.id });
    const productChunk = baseIds.map((b, j) => ({
      workspaceId,
      baseId: b.id,
      sku: `XLS-${stamp}-${i + j + 1}`,
      statusId,
      isDraft: draft,
    }));
    await db.insert(products).values(productChunk);
    imported += productChunk.length;
  }

  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "product",
    action: "products.imported",
    summaryAr: draft
      ? `${user.name} استورد ${imported} منتج كمسودة (بيانات ناقصة) من ملف Excel`
      : `${user.name} استورد ${imported} منتج من ملف Excel`,
  });
  await publish(query, { channel: `workspace:${workspaceId}`, type: "product_updated", payload: { imported } });

  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath("/products");
  return { ok: true, imported, skipped: 0 };
}
