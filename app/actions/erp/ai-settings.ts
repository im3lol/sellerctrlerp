"use server";

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { organizations } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { encryptSecret } from "@/lib/crypto";
import { tryRecordAudit } from "@/lib/erp/audit";
import { isAiModel } from "@/lib/erp/ai-bill";

/**
 * A company's own AI key. Stored encrypted on its organization row, used only for its own
 * reads, never shown back — the page only ever learns whether one is set. Replacing or
 * removing it is audited.
 */
export async function saveOrgAiKeyAction(input: { apiKey?: string; model: string }): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  if (!isAiModel(input.model)) return { error: "اختار موديل" };
  const key = input.apiKey?.trim();
  if (key && !key.startsWith("sk-ant-")) return { error: "ده مش شكل مفتاح Anthropic (بيبدأ بـ sk-ant-)" };

  return withOrgScope(auth.orgId, false, async () => {
    const [org] = await db.select({ key: organizations.aiApiKey }).from(organizations).where(eq(organizations.id, auth.orgId)).limit(1);
    if (!key && !org?.key) return { error: "ادخل المفتاح" };
    await db.update(organizations)
      .set({ aiModel: input.model, ...(key ? { aiApiKey: encryptSecret(key) } : {}) })
      .where(eq(organizations.id, auth.orgId));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "ORGANIZATION", entityId: auth.orgId,
      summary: key ? "إضافة/تغيير مفتاح الذكاء الاصطناعي الخاص بالشركة" : "تغيير موديل الذكاء الاصطناعي",
    });
    revalidatePath("/settings/ai");
    return { ok: true };
  });
}

export async function removeOrgAiKeyAction(): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    await db.update(organizations).set({ aiApiKey: null, aiModel: null }).where(eq(organizations.id, auth.orgId));
    await tryRecordAudit({
      orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "ORGANIZATION", entityId: auth.orgId,
      summary: "حذف مفتاح الذكاء الاصطناعي الخاص بالشركة",
    });
    revalidatePath("/settings/ai");
    return { ok: true };
  });
}
