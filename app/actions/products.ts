"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/lib/db";
import { products, productStatuses, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import { recordActivity, recordAudit, notify } from "@/lib/activity";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

export type ProductFormState = { error?: string; ok?: boolean };

const productSchema = z.object({
  name: z.string().min(1, "اسم المنتج مطلوب"),
  brand: z.string().optional(),
  description: z.string().optional(),
  features: z.string().optional(),
  sizes: z.string().optional(),
  price: z.string().optional(),
  imageUrl: z.string().optional(),
  galleryUrl: z.string().optional(),
  productUrl: z.string().optional(),
  statusId: z.string().uuid().optional().or(z.literal("")),
  assignedTo: z.string().uuid().optional().or(z.literal("")),
});

function readProductForm(formData: FormData) {
  return productSchema.safeParse({
    name: formData.get("name"),
    brand: formData.get("brand") || undefined,
    description: formData.get("description") || undefined,
    features: formData.get("features") || undefined,
    sizes: formData.get("sizes") || undefined,
    price: (formData.get("price") as string)?.replace(/[^\d.]/g, "") || undefined,
    imageUrl: formData.get("imageUrl") || undefined,
    galleryUrl: formData.get("galleryUrl") || undefined,
    productUrl: formData.get("productUrl") || undefined,
    statusId: formData.get("statusId") || "",
    assignedTo: formData.get("assignedTo") || "",
  });
}

/** Add a single product manually (admin/manager). */
export async function createProductAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const user = await requireUser();
  const workspaceId = String(formData.get("workspaceId") ?? "");
  if (!can(user.role, "product.edit") || !workspaceId || !(await canAccessWorkspace(user, workspaceId))) {
    return { error: "غير مصرّح أو مساحة عمل غير صالحة" };
  }
  const parsed = readProductForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  let statusId = d.statusId || null;
  if (!statusId) {
    const [def] = await db
      .select({ id: productStatuses.id })
      .from(productStatuses)
      .where(and(isNull(productStatuses.workspaceId), eq(productStatuses.isDefault, true)))
      .limit(1);
    statusId = def?.id ?? null;
  }

  const [p] = await db
    .insert(products)
    .values({
      workspaceId,
      sku: `MAN-${Date.now()}`,
      name: d.name,
      brand: d.brand ?? null,
      description: d.description ?? null,
      features: d.features ?? null,
      sizes: d.sizes ?? null,
      price: d.price ?? null,
      imageUrl: d.imageUrl ?? null,
      galleryUrl: d.galleryUrl ?? null,
      productUrl: d.productUrl ?? null,
      statusId,
      assignedTo: d.assignedTo || null,
    })
    .returning();

  if (d.assignedTo) {
    await notify({ userId: d.assignedTo, type: "product_assigned", title: "تم تعيين منتج جديد لك", body: d.name, link: `/products/${p.id}` });
  }
  await recordActivity({ actorId: user.id, workspaceId, entityType: "product", entityId: p.id, action: "product.created", summaryAr: `${user.name} أضاف المنتج «${d.name}»` });
  await publish(query, { channel: `workspace:${workspaceId}`, type: "product_updated", payload: { created: true } });
  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath("/products");
  return { ok: true };
}

/** Edit all product fields (locked + open). */
export async function updateProductAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const user = await requireUser();
  const productId = String(formData.get("productId") ?? "");
  const before = await loadProduct(productId);
  if (!before) return { error: "المنتج غير موجود" };
  if (!can(user.role, "product.edit") || !(await canAccessWorkspace(user, before.workspaceId))) {
    return { error: "غير مصرّح" };
  }
  const parsed = readProductForm(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const [status] = d.statusId
    ? await db.select().from(productStatuses).where(eq(productStatuses.id, d.statusId)).limit(1)
    : [undefined];

  await db
    .update(products)
    .set({
      name: d.name,
      brand: d.brand ?? null,
      description: d.description ?? null,
      features: d.features ?? null,
      sizes: d.sizes ?? null,
      price: d.price ?? null,
      imageUrl: d.imageUrl ?? null,
      galleryUrl: d.galleryUrl ?? null,
      productUrl: d.productUrl ?? null,
      statusId: d.statusId || before.statusId,
      assignedTo: d.assignedTo || null,
      completedAt: status?.isTerminal ? before.completedAt ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  await recordActivity({ actorId: user.id, workspaceId: before.workspaceId, entityType: "product", entityId: productId, action: "product.updated", summaryAr: `${user.name} عدّل بيانات المنتج «${d.name}»` });
  await publish(query, { channel: `workspace:${before.workspaceId}`, type: "product_updated", payload: { productId } });
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/workspaces/${before.workspaceId}`);
  revalidatePath("/products");
  return { ok: true };
}

/**
 * Confirm a draft product: completes the incomplete-data review and makes the
 * product visible to employees. Only managers/leads with edit rights.
 */
export async function publishProductAction(productId: string): Promise<ProductFormState> {
  const user = await requireUser();
  if (!can(user.role, "product.review")) return { error: "غير مصرّح" };
  const before = await loadProduct(productId);
  if (!before) return { error: "المنتج غير موجود" };
  if (!(await canAccessWorkspace(user, before.workspaceId))) return { error: "غير مصرّح" };
  if (!before.isDraft) return { ok: true }; // already published

  await db
    .update(products)
    .set({ isDraft: false, updatedAt: new Date() })
    .where(eq(products.id, productId));

  await recordActivity({
    actorId: user.id,
    workspaceId: before.workspaceId,
    entityType: "product",
    entityId: productId,
    action: "product.published",
    summaryAr: `${user.name} أكّد بيانات المنتج «${before.name}» وأتاحه للموظفين`,
  });
  if (before.assignedTo) {
    await notify({
      userId: before.assignedTo,
      type: "product_assigned",
      title: "منتج جاهز للعمل",
      body: before.name,
      link: `/products/${productId}`,
    });
  }
  await publish(query, {
    channel: `workspace:${before.workspaceId}`,
    type: "product_updated",
    payload: { productId, published: true },
  });
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/workspaces/${before.workspaceId}`);
  revalidatePath("/products");
  return { ok: true };
}

/**
 * Bulk-confirm drafts → visible to employees. Reviewers only; silently skips
 * products outside the user's accessible workspaces. Returns how many published.
 */
export async function publishProductsAction(ids: string[]): Promise<{ ok: boolean; published?: number; error?: string }> {
  const user = await requireUser();
  if (!can(user.role, "product.review")) return { ok: false, error: "غير مصرّح" };
  const wanted = ids.filter((id) => typeof id === "string" && id);
  if (wanted.length === 0) return { ok: false, error: "لم يتم تحديد منتجات" };

  const rows = await db
    .select()
    .from(products)
    .where(and(inArray(products.id, wanted), eq(products.isDraft, true)));

  let published = 0;
  const workspacesTouched = new Set<string>();
  for (const p of rows) {
    if (!(await canAccessWorkspace(user, p.workspaceId))) continue;
    await db.update(products).set({ isDraft: false, updatedAt: new Date() }).where(eq(products.id, p.id));
    workspacesTouched.add(p.workspaceId);
    published++;
    if (p.assignedTo) {
      await notify({
        userId: p.assignedTo,
        type: "product_assigned",
        title: "منتج جاهز للعمل",
        body: p.name,
        link: `/products/${p.id}`,
      });
    }
  }

  if (published > 0) {
    await recordActivity({
      actorId: user.id,
      workspaceId: rows[0]?.workspaceId,
      entityType: "product",
      action: "products.published",
      summaryAr: `${user.name} أكّد ${published} منتج وأتاحها للموظفين`,
    });
    for (const ws of workspacesTouched) {
      await publish(query, { channel: `workspace:${ws}`, type: "product_updated", payload: { bulkPublished: true } });
    }
    revalidatePath("/products");
  }
  return { ok: true, published };
}

async function loadProduct(id: string) {
  const [p] = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return p ?? null;
}

export async function setProductStatusAction(productId: string, statusId: string) {
  const user = await requireUser();
  if (!can(user.role, "product.edit")) throw new Error("forbidden");
  const before = await loadProduct(productId);
  if (!before) throw new Error("not found");

  const [status] = await db
    .select()
    .from(productStatuses)
    .where(eq(productStatuses.id, statusId))
    .limit(1);

  await db
    .update(products)
    .set({
      statusId,
      completedAt: status?.isTerminal ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  await recordActivity({
    actorId: user.id,
    workspaceId: before.workspaceId,
    entityType: "product",
    entityId: productId,
    action: "product.status_changed",
    summaryAr: `${user.name} غيّر حالة المنتج «${before.name}» إلى ${status?.name ?? ""}`,
  });
  await recordAudit({
    actorId: user.id,
    entityType: "product",
    entityId: productId,
    action: "status_changed",
    before: { statusId: before.statusId },
    after: { statusId },
  });
  await publish(query, {
    channel: `workspace:${before.workspaceId}`,
    type: "product_updated",
    payload: { productId, statusId },
  });
  revalidatePath(`/workspaces/${before.workspaceId}`);
  revalidatePath(`/products/${productId}`);
  revalidatePath("/products");
}

export async function assignProductAction(productId: string, assigneeId: string | null) {
  const user = await requireUser();
  if (!can(user.role, "product.edit")) throw new Error("forbidden");
  const before = await loadProduct(productId);
  if (!before) throw new Error("not found");

  await db
    .update(products)
    .set({ assignedTo: assigneeId, updatedAt: new Date() })
    .where(eq(products.id, productId));

  if (assigneeId) {
    const [assignee] = await db.select().from(users).where(eq(users.id, assigneeId)).limit(1);
    await notify({
      userId: assigneeId,
      type: "product_assigned",
      title: "تم تعيين منتج جديد لك",
      body: before.name,
      link: `/products/${productId}`,
    });
    await recordActivity({
      actorId: user.id,
      workspaceId: before.workspaceId,
      entityType: "product",
      entityId: productId,
      action: "product.assigned",
      summaryAr: `${user.name} عيّن المنتج «${before.name}» إلى ${assignee?.name ?? ""}`,
    });
  }
  await publish(query, {
    channel: `workspace:${before.workspaceId}`,
    type: "product_updated",
    payload: { productId, assigneeId },
  });
  revalidatePath(`/workspaces/${before.workspaceId}`);
  revalidatePath(`/products/${productId}`);
}

const EDITABLE = ["notes", "amazonCode", "internalNotes"] as const;
type EditableField = (typeof EDITABLE)[number];

export async function updateProductFieldAction(
  productId: string,
  field: EditableField,
  value: string,
) {
  const user = await requireUser();
  if (!can(user.role, "product.edit")) throw new Error("forbidden");
  if (!EDITABLE.includes(field)) throw new Error("invalid field");
  const before = await loadProduct(productId);
  if (!before) throw new Error("not found");

  await db
    .update(products)
    .set({ [field]: value, updatedAt: new Date() })
    .where(eq(products.id, productId));

  await recordActivity({
    actorId: user.id,
    workspaceId: before.workspaceId,
    entityType: "product",
    entityId: productId,
    action: "product.updated",
    summaryAr: `${user.name} حدّث بيانات المنتج «${before.name}»`,
  });
  await publish(query, {
    channel: `workspace:${before.workspaceId}`,
    type: "product_updated",
    payload: { productId, field },
  });
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/workspaces/${before.workspaceId}`);
}
