"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { products, productStatuses, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { recordActivity, recordAudit, notify } from "@/lib/activity";
import { publish } from "@/lib/realtime";

const query = (text: string, params: unknown[]) => pool.query(text, params);

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
