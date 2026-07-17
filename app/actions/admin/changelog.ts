"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { changelogEntries } from "@/db/schema";
import { requireCapability } from "@/lib/session";
import { ALL_MODULES } from "@/lib/erp/module-list";
import { CHANGELOG_KINDS } from "@/lib/erp/changelog";

type Res = { ok: true; id?: string } | { error: string };

function refresh() {
  revalidatePath("/admin/changelog");
  revalidatePath("/erp/whats-new");
}

const schema = z.object({
  title: z.string().min(2, "العنوان قصير جداً"),
  body: z.string().min(2, "اكتب الشرح"),
  kind: z.enum(CHANGELOG_KINDS).default("feature"),
  // Empty = the whole product rather than one module.
  module: z.enum(ALL_MODULES).optional().or(z.literal("")),
  releasedAt: z.string().min(1, "التاريخ مطلوب"),
  isPublished: z.boolean().default(true),
});

export async function saveChangelogAction(input: unknown, id?: string): Promise<Res> {
  await requireCapability("employee.manage");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  const released = new Date(d.releasedAt);
  // A bad date silently becomes 1970 and sorts to the bottom of the list forever.
  if (Number.isNaN(released.getTime())) return { error: "التاريخ غير صحيح" };

  const values = {
    title: d.title.trim(),
    body: d.body.trim(),
    kind: d.kind,
    module: d.module || null,
    releasedAt: released,
    isPublished: d.isPublished,
    updatedAt: new Date(),
  };

  try {
    if (id) {
      await db.update(changelogEntries).set(values).where(eq(changelogEntries.id, id));
      refresh();
      return { ok: true, id };
    }
    const [r] = await db.insert(changelogEntries).values(values).returning({ id: changelogEntries.id });
    refresh();
    return { ok: true, id: r.id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "تعذّر الحفظ" };
  }
}

/** Publish/unpublish — writing a note and shipping it are different moments. */
export async function toggleChangelogAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  const [c] = await db.select({ isPublished: changelogEntries.isPublished }).from(changelogEntries)
    .where(eq(changelogEntries.id, id)).limit(1);
  if (!c) return { error: "التحديث غير موجود" };
  await db.update(changelogEntries).set({ isPublished: !c.isPublished, updatedAt: new Date() })
    .where(eq(changelogEntries.id, id));
  refresh();
  return { ok: true };
}

export async function deleteChangelogAction(id: string): Promise<Res> {
  await requireCapability("employee.manage");
  await db.delete(changelogEntries).where(eq(changelogEntries.id, id));
  refresh();
  return { ok: true };
}
