"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { academyLessons } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";

type Res = { ok: true; id?: string } | { error: string };

/**
 * Lessons are platform content, so every tenant sees an edit immediately. Refresh
 * the admin list and the academy pages together — the module cards carry counts that
 * change the moment a lesson is added, hidden or filled in.
 */
function refresh() {
  revalidatePath("/admin/academy");
  revalidatePath("/erp/academy");
  revalidatePath("/erp/academy/[module]", "page");
  revalidatePath("/erp/academy/[module]/[slug]", "page");
}

const schema = z.object({
  slug: z.string().min(1, "المعرّف مطلوب").regex(/^[a-z0-9-]+$/, "المعرّف: حروف إنجليزية صغيرة وأرقام وشرطات فقط"),
  title: z.string().min(2, "العنوان قصير جداً"),
  module: z.enum(ALL_MODULES),
  outcome: z.string().optional(),
  // Both empty = قريباً. A blank string must become null, not "", or the lesson would
  // render as live and go nowhere.
  url: z.string().url("رابط غير صحيح").optional().or(z.literal("")),
  body: z.string().optional(),
  minutes: z.number().int().positive().optional().nullable(),
  level: z.enum(["basic", "advanced"]).default("basic"),
  sortOrder: z.number().int().default(0),
});

export async function saveLessonAction(input: unknown, id?: string): Promise<Res> {
  await requireCapability("employee.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const values = {
    slug: d.slug.trim(),
    title: d.title.trim(),
    module: d.module,
    outcome: d.outcome?.trim() || null,
    url: d.url?.trim() || null,
    body: d.body?.trim() || null,
    minutes: d.minutes ?? null,
    level: d.level,
    sortOrder: d.sortOrder,
    updatedAt: new Date(),
  };

  try {
    if (id) {
      await db.update(academyLessons).set(values).where(eq(academyLessons.id, id));
      refresh();
      return { ok: true, id };
    }
    const [r] = await db.insert(academyLessons).values(values).returning({ id: academyLessons.id });
    refresh();
    return { ok: true, id: r.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // The slug is the anchor/route, so it has a unique index.
    if (msg.includes("unique") || msg.includes("23505")) return { error: "المعرّف مستخدم بالفعل" };
    return { error: msg || "تعذّر الحفظ" };
  }
}

/** Hide/show without deleting — a lesson pulled for a re-record keeps its slug. */
export async function toggleLessonAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  const [l] = await db.select({ isActive: academyLessons.isActive }).from(academyLessons)
    .where(eq(academyLessons.id, id)).limit(1);
  if (!l) return { error: "الدرس غير موجود" };
  await db.update(academyLessons).set({ isActive: !l.isActive, updatedAt: new Date() })
    .where(eq(academyLessons.id, id));
  refresh();
  return { ok: true };
}

export async function deleteLessonAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  await db.delete(academyLessons).where(eq(academyLessons.id, id));
  refresh();
  return { ok: true };
}
