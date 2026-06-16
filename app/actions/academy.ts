"use server";

import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { academyItems, academyViews, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/rbac";
import { youtubeId } from "@/lib/academy";

export type AcademyFormState = { ok?: boolean; error?: string };

/** Publish a learning item (managers only). */
export async function createAcademyItemAction(
  _prev: AcademyFormState,
  formData: FormData,
): Promise<AcademyFormState> {
  const user = await requireUser();
  if (!can(user.role, "employee.manage")) return { error: "غير مصرّح" };

  const type = String(formData.get("type") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim() || null;
  const youtubeUrl = String(formData.get("youtubeUrl") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "").trim() || null;

  if (!["article", "video", "tip"].includes(type)) return { error: "نوع غير صالح" };
  if (!title) return { error: "العنوان مطلوب" };
  if (type === "video" && !youtubeId(youtubeUrl)) return { error: "رابط يوتيوب غير صالح" };
  if ((type === "article" || type === "tip") && !body) return { error: "المحتوى مطلوب" };

  await db.insert(academyItems).values({
    type,
    title,
    body,
    youtubeUrl: type === "video" ? youtubeUrl : null,
    category,
    createdById: user.id,
  });

  revalidatePath("/academy");
  return { ok: true };
}

/** Delete a learning item (managers only). */
export async function deleteAcademyItemAction(id: string): Promise<AcademyFormState> {
  const user = await requireUser();
  if (!can(user.role, "employee.manage")) return { error: "غير مصرّح" };
  await db.delete(academyItems).where(eq(academyItems.id, id));
  revalidatePath("/academy");
  return { ok: true };
}

/** Record that the current user read/watched an item (first time counts). */
export async function recordAcademyViewAction(itemId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await db
    .insert(academyViews)
    .values({ itemId, userId: user.id })
    .onConflictDoNothing({ target: [academyViews.itemId, academyViews.userId] });
  revalidatePath("/academy");
  return { ok: true };
}

/** Who read/watched an item (managers only). */
export async function getAcademyViewersAction(
  itemId: string,
): Promise<{ ok: boolean; viewers?: { name: string; at: string }[]; error?: string }> {
  const user = await requireUser();
  if (!can(user.role, "employee.manage")) return { ok: false, error: "غير مصرّح" };
  const rows = await db
    .select({ name: users.name, at: academyViews.createdAt })
    .from(academyViews)
    .innerJoin(users, eq(academyViews.userId, users.id))
    .where(eq(academyViews.itemId, itemId))
    .orderBy(desc(academyViews.createdAt));
  return { ok: true, viewers: rows.map((r) => ({ name: r.name, at: r.at.toISOString() })) };
}
