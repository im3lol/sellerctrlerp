"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, isNotNull, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/lib/db";
import { products, productStatuses, users, productBases, workspaces } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { canAccessWorkspace } from "@/lib/workspaces";
import { can } from "@/lib/rbac";
import { recordActivity, recordAudit, notify } from "@/lib/activity";
import { publish } from "@/lib/realtime";
import { maybeAutoDistribute } from "@/lib/distribution";

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

  // Create the shared base catalog item, then the platform listing referencing it.
  const [ws] = await db.select({ clientUserId: workspaces.clientUserId }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const [createdBase] = await db
    .insert(productBases)
    .values({
      clientUserId: ws?.clientUserId ?? null,
      name: d.name,
      brand: d.brand ?? null,
      description: d.description ?? null,
      features: d.features ?? null,
      sizes: d.sizes ?? null,
      price: d.price ?? null,
      imageUrl: d.imageUrl ?? null,
      galleryUrl: d.galleryUrl ?? null,
      productUrl: d.productUrl ?? null,
      createdById: user.id,
    })
    .returning({ id: productBases.id });

  const [p] = await db
    .insert(products)
    .values({
      workspaceId,
      baseId: createdBase.id,
      sku: `MAN-${Date.now()}`,
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

  // Per-listing fields live on the product row.
  await db
    .update(products)
    .set({
      statusId: d.statusId || before.statusId,
      assignedTo: d.assignedTo || null,
      completedAt: status?.isTerminal ? before.completedAt ?? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(products.id, productId));

  // Base data is shared — written ONCE to the base; every platform listing of
  // this product reads it via the join automatically.
  if (before.baseId) {
    await db
      .update(productBases)
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
        updatedAt: new Date(),
      })
      .where(eq(productBases.id, before.baseId));
  }

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
  await maybeAutoDistribute(before.workspaceId, user.id);
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
    .select({
      id: products.id,
      workspaceId: products.workspaceId,
      assignedTo: products.assignedTo,
      name: productBases.name,
    })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .where(and(inArray(products.id, wanted), eq(products.isDraft, true)));

  // Check workspace access ONCE per distinct workspace (not per product).
  const distinctWs = [...new Set(rows.map((r) => r.workspaceId))];
  const allowedWs = new Set<string>();
  for (const ws of distinctWs) {
    if (await canAccessWorkspace(user, ws)) allowedWs.add(ws);
  }
  const allowed = rows.filter((r) => allowedWs.has(r.workspaceId));
  const published = allowed.length;
  const workspacesTouched = new Set(allowed.map((r) => r.workspaceId));

  if (published > 0) {
    // One bulk UPDATE instead of one per product.
    await db
      .update(products)
      .set({ isDraft: false, updatedAt: new Date() })
      .where(inArray(products.id, allowed.map((r) => r.id)));

    // Notify assignees (notifications are inherently per-user; best-effort).
    for (const p of allowed) {
      if (p.assignedTo) {
        await notify({ userId: p.assignedTo, type: "product_assigned", title: "منتج جاهز للعمل", body: p.name ?? undefined, link: `/products/${p.id}` });
      }
    }

    await recordActivity({
      actorId: user.id,
      workspaceId: rows[0]?.workspaceId,
      entityType: "product",
      action: "products.published",
      summaryAr: `${user.name} أكّد ${published} منتج وأتاحها للموظفين`,
    });
    for (const ws of workspacesTouched) {
      await publish(query, { channel: `workspace:${ws}`, type: "product_updated", payload: { bulkPublished: true } });
      await maybeAutoDistribute(ws, user.id);
    }
    revalidatePath("/products");
  }
  return { ok: true, published };
}

/**
 * Confirm ALL "ready" drafts in a workspace (beyond the current page). Ready =
 * core fields filled (name + image + price). Reviewer + workspace-access gated.
 */
export async function publishWorkspaceReadyDraftsAction(
  workspaceId: string,
): Promise<{ ok: boolean; published?: number; error?: string }> {
  const user = await requireUser();
  if (!can(user.role, "product.review")) return { ok: false, error: "غير مصرّح" };
  if (!(await canAccessWorkspace(user, workspaceId))) return { ok: false, error: "غير مصرّح" };

  const rows = await db
    .select({ id: products.id, assignedTo: products.assignedTo, name: productBases.name })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .where(
      and(
        eq(products.workspaceId, workspaceId),
        eq(products.isDraft, true),
        isNotNull(productBases.imageUrl),
        isNotNull(productBases.price),
      ),
    );
  if (rows.length === 0) return { ok: true, published: 0 };

  await db
    .update(products)
    .set({ isDraft: false, updatedAt: new Date() })
    .where(inArray(products.id, rows.map((r) => r.id)));

  for (const r of rows) {
    if (r.assignedTo) {
      await notify({ userId: r.assignedTo, type: "product_assigned", title: "منتج جاهز للعمل", body: r.name ?? undefined, link: `/products/${r.id}` });
    }
  }
  await recordActivity({
    actorId: user.id,
    workspaceId,
    entityType: "product",
    action: "products.published",
    summaryAr: `${user.name} أكّد ${rows.length} منتج جاهز وأتاحها للموظفين`,
  });
  await publish(query, { channel: `workspace:${workspaceId}`, type: "product_updated", payload: { bulkPublished: true } });
  await maybeAutoDistribute(workspaceId, user.id);
  revalidatePath(`/workspaces/${workspaceId}`);
  revalidatePath("/products");
  return { ok: true, published: rows.length };
}

/**
 * Bulk-delete products (managers with product.distribute only — stricter than
 * confirm). Workspace-scoped; silently skips products outside access.
 */
export async function deleteProductsAction(ids: string[]): Promise<{ ok: boolean; deleted?: number; error?: string }> {
  const user = await requireUser();
  if (!can(user.role, "product.distribute")) return { ok: false, error: "غير مصرّح (المديرون فقط)" };
  const wanted = ids.filter((id) => typeof id === "string" && id);
  if (wanted.length === 0) return { ok: false, error: "لم يتم تحديد منتجات" };

  const rows = await db
    .select({ id: products.id, workspaceId: products.workspaceId })
    .from(products)
    .where(inArray(products.id, wanted));

  const allowed: string[] = [];
  const workspacesTouched = new Set<string>();
  for (const p of rows) {
    if (await canAccessWorkspace(user, p.workspaceId)) {
      allowed.push(p.id);
      workspacesTouched.add(p.workspaceId);
    }
  }
  if (allowed.length === 0) return { ok: false, error: "غير مصرّح" };

  await db.delete(products).where(inArray(products.id, allowed));

  await recordActivity({
    actorId: user.id,
    workspaceId: rows[0]?.workspaceId,
    entityType: "product",
    action: "products.deleted",
    summaryAr: `${user.name} حذف ${allowed.length} منتج`,
  });
  for (const ws of workspacesTouched) {
    await publish(query, { channel: `workspace:${ws}`, type: "product_updated", payload: { bulkDeleted: true } });
  }
  revalidatePath("/products");
  return { ok: true, deleted: allowed.length };
}

/**
 * Publish an existing product to another platform (workspace) as a new listing
 * that SHARES the same base catalog item — no base-data re-entry. The new
 * listing starts fresh per-platform: default status, unassigned, empty code/notes.
 */
export async function createListingAction(
  productId: string,
  targetWorkspaceId: string,
): Promise<{ ok: boolean; error?: string; listingId?: string }> {
  const user = await requireUser();
  if (!can(user.role, "product.distribute")) return { ok: false, error: "غير مصرّح (المديرون فقط)" };
  const src = await loadProduct(productId);
  if (!src) return { ok: false, error: "المنتج غير موجود" };
  if (!(await canAccessWorkspace(user, targetWorkspaceId))) return { ok: false, error: "غير مصرّح بهذه المساحة" };
  if (targetWorkspaceId === src.workspaceId) return { ok: false, error: "المنتج موجود بالفعل في هذه المساحة" };
  if (!src.baseId) return { ok: false, error: "هذا المنتج غير مرتبط بعنصر أساسي" };

  // Don't duplicate the same base on the same workspace.
  const [dup] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.baseId, src.baseId), eq(products.workspaceId, targetWorkspaceId)))
    .limit(1);
  if (dup) return { ok: false, error: "المنتج منشور بالفعل على هذه المنصة" };

  const [def] = await db
    .select({ id: productStatuses.id })
    .from(productStatuses)
    .where(and(isNull(productStatuses.workspaceId), eq(productStatuses.isDefault, true)))
    .limit(1);

  const [listing] = await db
    .insert(products)
    .values({
      workspaceId: targetWorkspaceId,
      baseId: src.baseId, // shares the SAME base — no base-data duplication
      sku: `LST-${Date.now()}`,
      // fresh per-platform fields
      statusId: def?.id ?? null,
      isDraft: false,
    })
    .returning({ id: products.id });

  await recordActivity({
    actorId: user.id,
    workspaceId: targetWorkspaceId,
    entityType: "product",
    entityId: listing.id,
    action: "product.listing_added",
    summaryAr: `${user.name} نشر المنتج «${src.name}» على منصة جديدة`,
  });
  await publish(query, { channel: `workspace:${targetWorkspaceId}`, type: "product_updated", payload: { created: true } });
  revalidatePath(`/products/${productId}`);
  revalidatePath(`/workspaces/${targetWorkspaceId}`);
  revalidatePath("/products");
  return { ok: true, listingId: listing.id };
}

/** Load a product listing merged with its shared base data (single source). */
async function loadProduct(id: string) {
  const [row] = await db
    .select({ p: products, b: productBases })
    .from(products)
    .leftJoin(productBases, eq(products.baseId, productBases.id))
    .where(eq(products.id, id))
    .limit(1);
  if (!row) return null;
  const { p, b } = row;
  return {
    ...p,
    // base fields (read-through for back-compat with existing call sites)
    name: b?.name ?? "",
    brand: b?.brand ?? null,
    description: b?.description ?? null,
    sizes: b?.sizes ?? null,
    features: b?.features ?? null,
    colors: b?.colors ?? null,
    imageUrl: b?.imageUrl ?? null,
    galleryUrl: b?.galleryUrl ?? null,
    productUrl: b?.productUrl ?? null,
    price: b?.price ?? null,
    baseData: b?.baseData ?? {},
  };
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
  // Assigning the responsible person is a management action (not for employees).
  if (!can(user.role, "product.review")) throw new Error("forbidden");
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
