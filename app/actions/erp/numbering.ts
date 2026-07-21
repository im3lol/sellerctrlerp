"use server";

import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documentPrefixes } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { DOC_TYPES, isValidPrefix } from "@/lib/erp/doc-types";

/**
 * Save per-org document-number prefixes. A field left blank (or equal to the
 * default key) removes the override — so the number series reverts to the
 * default. Effective prefixes must stay unique across doc types, otherwise two
 * unrelated series would share one counter (the old PR bug).
 */
export async function saveDocumentPrefixesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const auth = await authorizeErp("settings.edit");
  if ("error" in auth) return auth;

  // Resolve each type's effective prefix from the form (blank/same = default key).
  const effective: Record<string, string> = {};
  for (const { key } of DOC_TYPES) {
    const raw = ((formData.get(`prefix_${key}`) as string) || "").trim().toUpperCase();
    const p = raw && raw !== key ? raw : key;
    if (p !== key && !isValidPrefix(p)) {
      return { error: `البادئة «${raw}» غير صالحة — من ١ إلى ٦ أحرف لاتينية كبيرة فقط` };
    }
    effective[key] = p;
  }

  // No two doc types may resolve to the same printed prefix.
  const seen = new Map<string, string>();
  for (const { key, label } of DOC_TYPES) {
    const p = effective[key];
    const clash = seen.get(p);
    if (clash) return { error: `البادئة «${p}» مستخدمة في «${clash}» و«${label}» — لازم تكون مميزة` };
    seen.set(p, label);
  }

  return withOrgScope(auth.orgId, false, async () => {
    try {
      for (const { key } of DOC_TYPES) {
        const p = effective[key];
        if (p === key) {
          await db.delete(documentPrefixes)
            .where(and(eq(documentPrefixes.organizationId, auth.orgId), eq(documentPrefixes.docKey, key)));
        } else {
          await db.insert(documentPrefixes)
            .values({ organizationId: auth.orgId, docKey: key, prefix: p })
            .onConflictDoUpdate({
              target: [documentPrefixes.organizationId, documentPrefixes.docKey],
              set: { prefix: p, updatedAt: new Date() },
            });
        }
      }
    } catch {
      return { error: "تعذّر حفظ بادئات الترقيم" };
    }
    revalidatePath("/settings/numbering");
    return { ok: true };
  });
}
