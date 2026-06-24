"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { crmOpportunities, crmStages, customers } from "@/db/schema";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";

export type { ActionState };
export type SaveOppState = ActionState & { id?: string };

const schema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "اسم الفرصة مطلوب"),
  customerId: z.string().optional().or(z.literal("")),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  stageId: z.string().optional().or(z.literal("")),
  expectedRevenue: z.coerce.number().min(0).default(0),
  probability: z.coerce.number().min(0).max(100, "الاحتمالية بين 0 و100").default(0),
  expectedCloseDate: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
});

/** Resolve a stage id that belongs to the org, falling back to the first stage. */
async function resolveStage(orgId: string, stageId?: string): Promise<string | null> {
  if (stageId) {
    const [s] = await db.select({ id: crmStages.id }).from(crmStages)
      .where(and(eq(crmStages.id, stageId), eq(crmStages.organizationId, orgId))).limit(1);
    if (s) return s.id;
  }
  const [first] = await db.select({ id: crmStages.id }).from(crmStages)
    .where(eq(crmStages.organizationId, orgId)).orderBy(crmStages.sortOrder).limit(1);
  return first?.id ?? null;
}

/** Create or update an opportunity (the salesperson defaults to the creator). */
export async function saveOpportunityAction(_prev: SaveOppState, formData: FormData): Promise<SaveOppState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;

  const parsed = schema.safeParse({
    id: (formData.get("id") as string) || undefined,
    name: formData.get("name"),
    customerId: formData.get("customerId") === "none" ? "" : formData.get("customerId") || "",
    contactName: formData.get("contactName") || undefined,
    phone: formData.get("phone") || undefined,
    email: formData.get("email") || undefined,
    stageId: formData.get("stageId") || "",
    expectedRevenue: formData.get("expectedRevenue") || 0,
    probability: formData.get("probability") || 0,
    expectedCloseDate: formData.get("expectedCloseDate") || undefined,
    source: formData.get("source") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  // Validate the linked customer belongs to the org.
  let customerId: string | null = null;
  if (d.customerId) {
    const [c] = await db.select({ id: customers.id }).from(customers)
      .where(and(eq(customers.id, d.customerId), eq(customers.organizationId, auth.orgId))).limit(1);
    if (!c) return { error: "العميل غير موجود في هذه المؤسسة" };
    customerId = c.id;
  }
  const stageId = await resolveStage(auth.orgId, d.stageId || undefined);

  const values = {
    name: d.name,
    customerId,
    contactName: d.contactName || null,
    phone: d.phone || null,
    email: d.email || null,
    stageId,
    expectedRevenue: String(d.expectedRevenue),
    probability: d.probability,
    expectedCloseDate: d.expectedCloseDate ? new Date(d.expectedCloseDate) : null,
    source: d.source || null,
    notes: d.notes || null,
  };

  try {
    if (d.id) {
      const r = await db.update(crmOpportunities).set({ ...values, updatedAt: new Date() })
        .where(and(eq(crmOpportunities.id, d.id), eq(crmOpportunities.organizationId, auth.orgId)))
        .returning({ id: crmOpportunities.id });
      if (!r.length) return { error: "الفرصة غير موجودة" };
      revalidatePath("/erp/crm");
      return { ok: true, id: d.id };
    }
    const number = await nextDocumentNumber(db, auth.orgId, "OPP", new Date().getFullYear());
    const [opp] = await db.insert(crmOpportunities)
      .values({ organizationId: auth.orgId, number, salespersonId: auth.userId, status: "OPEN", ...values })
      .returning({ id: crmOpportunities.id });
    revalidatePath("/erp/crm");
    return { ok: true, id: opp.id };
  } catch {
    return { error: "تعذّر حفظ الفرصة" };
  }
}

/** Move an opportunity to another stage (Kanban). Won/Lost stages also flip its status. */
export async function moveOpportunityStageAction(id: string, stageId: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const [stage] = await db.select({ id: crmStages.id, isWon: crmStages.isWon, isLost: crmStages.isLost })
    .from(crmStages).where(and(eq(crmStages.id, stageId), eq(crmStages.organizationId, auth.orgId))).limit(1);
  if (!stage) return { error: "المرحلة غير موجودة" };
  const status = stage.isWon ? "WON" : stage.isLost ? "LOST" : "OPEN";
  const r = await db.update(crmOpportunities).set({ stageId, status, updatedAt: new Date() })
    .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.organizationId, auth.orgId)))
    .returning({ id: crmOpportunities.id });
  if (!r.length) return { error: "الفرصة غير موجودة" };
  revalidatePath("/erp/crm");
  return { ok: true };
}

/** Mark an opportunity won / lost / reopened. */
export async function setOpportunityStatusAction(id: string, status: "WON" | "LOST" | "OPEN", lostReason?: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  const r = await db.update(crmOpportunities)
    .set({ status, lostReason: status === "LOST" ? lostReason || null : null, updatedAt: new Date() })
    .where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.organizationId, auth.orgId)))
    .returning({ id: crmOpportunities.id });
  if (!r.length) return { error: "الفرصة غير موجودة" };
  revalidatePath("/erp/crm");
  return { ok: true };
}

export async function deleteOpportunityAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("sales.create");
  if ("error" in auth) return auth;
  await db.delete(crmOpportunities).where(and(eq(crmOpportunities.id, id), eq(crmOpportunities.organizationId, auth.orgId)));
  revalidatePath("/erp/crm");
  return { ok: true };
}
