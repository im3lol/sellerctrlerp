"use server";

import { z } from "zod";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { revalidatePath } from "@/lib/safe-revalidate";
import { automationRules, orgSubscriptions, plans } from "@/db/schema";
import { authorizeErp, type ActionState } from "@/lib/erp/action-auth";
import { encryptSecret } from "@/lib/crypto";
import { tryRecordAudit } from "@/lib/erp/audit";
import {
  ACTION_LABEL, DOCS, EVENT_LABEL, SECRET_KEPT, TEMPLATES, fill, isEvent, matches, validateSpec,
  type Action, type Facts, type RuleSpec,
} from "@/lib/erp/automation/model";
import { findDocId, loadFacts } from "@/lib/erp/automation/facts";

/**
 * Workflow rules — who may build them (automation.manage), how many a plan allows, and a
 * dry run on a real document. Saving never runs anything; the worker does, on events.
 */

const conditionSchema = z.object({
  field: z.string().max(40),
  op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "notContains", "empty", "notEmpty"]),
  value: z.string().max(200).optional(),
});
const actionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("notify"),
    to: z.object({
      creator: z.boolean().optional(),
      roles: z.array(z.string().max(30)).max(10).optional(),
      users: z.array(z.string().max(64)).max(50).optional(),
    }),
    message: z.string().max(1000),
  }),
  z.object({ type: z.literal("followUp"), assignee: z.string().max(64), inDays: z.number().int(), summary: z.string().max(500) }),
  z.object({ type: z.literal("comment"), body: z.string().max(2000) }),
  z.object({ type: z.literal("webhook"), url: z.string().trim().max(500), secret: z.string().max(200).optional() }),
]);
const specSchema = z.object({
  trigger: z.object({ kind: z.literal("event"), entity: z.string().max(40), event: z.string().max(20) }),
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).max(10),
  actions: z.array(actionSchema).max(10),
});

function parseSpec(raw: unknown): { spec: RuleSpec } | { error: string } {
  const parsed = specSchema.safeParse(raw);
  if (!parsed.success) return { error: "القاعدة فيها بيانات مش مفهومة" };
  const spec = parsed.data as RuleSpec;
  const bad = validateSpec(spec);
  return bad ? { error: bad } : { spec };
}

/** How many rules the company's plan allows — null when there's no cap (or no plan yet: the trial). */
async function ruleLimit(orgId: string): Promise<number | null> {
  const [row] = await db.select({ max: plans.maxAutomations }).from(orgSubscriptions)
    .leftJoin(plans, eq(plans.id, orgSubscriptions.planId))
    .where(eq(orgSubscriptions.organizationId, orgId)).limit(1);
  return row?.max ?? null;
}

/** Webhook secrets: a new one is encrypted; the editor's «kept» marker keeps the stored one. */
function secureActions(actions: Action[], previous: Action[] | undefined): Action[] {
  return actions.map((a, i) => {
    if (a.type !== "webhook") return a;
    const prev = previous?.[i];
    if (a.secret === SECRET_KEPT) {
      return prev?.type === "webhook" && prev.secret ? { type: "webhook", url: a.url, secret: prev.secret } : { type: "webhook", url: a.url };
    }
    return a.secret?.trim() ? { type: "webhook", url: a.url, secret: encryptSecret(a.secret.trim()) } : { type: "webhook", url: a.url };
  });
}

export async function saveRuleAction(input: { id?: string; name: string; enabled: boolean; spec: unknown }): Promise<ActionState & { id?: string }> {
  const auth = await authorizeErp("automation.manage");
  if ("error" in auth) return auth;
  const name = (input.name ?? "").trim().slice(0, 120);
  if (!name) return { error: "سمّي القاعدة" };
  const parsed = parseSpec(input.spec);
  if ("error" in parsed) return parsed;

  return withOrgScope(auth.orgId, false, async () => {
    if (input.id) {
      const [existing] = await db.select({ spec: automationRules.spec }).from(automationRules)
        .where(and(eq(automationRules.id, input.id), eq(automationRules.organizationId, auth.orgId))).limit(1);
      if (!existing) return { error: "القاعدة مش موجودة" };
      const spec = { ...parsed.spec, actions: secureActions(parsed.spec.actions, existing.spec.actions) };
      await db.update(automationRules).set({ name, enabled: !!input.enabled, spec, updatedAt: new Date() })
        .where(eq(automationRules.id, input.id));
      await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "AUTOMATION_RULE", entityId: input.id, summary: `تعديل قاعدة الأتمتة «${name}»` });
      revalidatePath("/automation");
      return { ok: true, id: input.id };
    }

    const limit = await ruleLimit(auth.orgId);
    if (limit != null) {
      const [{ n }] = await db.select({ n: count() }).from(automationRules).where(eq(automationRules.organizationId, auth.orgId));
      if (n >= limit) return { error: `باقتك بتسمح بـ${limit} قاعدة أتمتة — رقّي الباقة أو امسح قاعدة` };
    }
    const spec = { ...parsed.spec, actions: secureActions(parsed.spec.actions, undefined) };
    const [row] = await db.insert(automationRules)
      .values({ organizationId: auth.orgId, name, enabled: !!input.enabled, spec, createdBy: auth.userId })
      .returning({ id: automationRules.id });
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "CREATE", entityType: "AUTOMATION_RULE", entityId: row.id, summary: `قاعدة أتمتة جديدة «${name}»` });
    revalidatePath("/automation");
    return { ok: true, id: row.id };
  });
}

export async function toggleRuleAction(id: string, enabled: boolean): Promise<ActionState> {
  const auth = await authorizeErp("automation.manage");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db.update(automationRules).set({ enabled, updatedAt: new Date() })
      .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, auth.orgId)))
      .returning({ name: automationRules.name });
    if (!row) return { error: "القاعدة مش موجودة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "UPDATE", entityType: "AUTOMATION_RULE", entityId: id, summary: `${enabled ? "تشغيل" : "إيقاف"} قاعدة الأتمتة «${row.name}»` });
    revalidatePath("/automation");
    return { ok: true };
  });
}

export async function deleteRuleAction(id: string): Promise<ActionState> {
  const auth = await authorizeErp("automation.manage");
  if ("error" in auth) return auth;
  return withOrgScope(auth.orgId, false, async () => {
    const [row] = await db.delete(automationRules)
      .where(and(eq(automationRules.id, id), eq(automationRules.organizationId, auth.orgId)))
      .returning({ name: automationRules.name });
    if (!row) return { error: "القاعدة مش موجودة" };
    await tryRecordAudit({ orgId: auth.orgId, userId: auth.userId, action: "DELETE", entityType: "AUTOMATION_RULE", entityId: id, summary: `مسح قاعدة الأتمتة «${row.name}»` });
    revalidatePath("/automation");
    return { ok: true };
  });
}

/** Add a ready-made rule. The webhook recipe starts switched off — its URL is a placeholder. */
export async function addTemplateAction(key: string): Promise<ActionState & { id?: string }> {
  const t = TEMPLATES.find((x) => x.key === key);
  if (!t) return { error: "الوصفة مش موجودة" };
  const hasPlaceholder = t.spec.actions.some((a) => a.type === "webhook");
  return saveRuleAction({ name: t.title, enabled: !hasPlaceholder, spec: t.spec });
}

export type RuleTestResult = ActionState & { matched?: boolean; facts?: Facts; lines?: string[] };

/** What the rule would do on a real document — nothing is sent or written. */
export async function testRuleAction(spec: unknown, number: string): Promise<RuleTestResult> {
  const auth = await authorizeErp("automation.manage");
  if ("error" in auth) return auth;
  const parsed = parseSpec(spec);
  if ("error" in parsed) return parsed;
  const s = parsed.spec;
  if (!number.trim()) return { error: "اكتب رقم مستند تجرّب عليه" };

  return withOrgScope(auth.orgId, false, async () => {
    const id = await findDocId(auth.orgId, s.trigger.entity, number);
    if (!id) return { error: `مفيش ${DOCS[s.trigger.entity].label} بالرقم ده` };
    const loaded = await loadFacts(auth.orgId, s.trigger.entity, id);
    if (!loaded) return { error: "تعذّر قراءة المستند" };
    const matched = matches(s, loaded.facts);
    const extra = { doc: DOCS[s.trigger.entity].label, event: isEvent(s.trigger.event) ? EVENT_LABEL[s.trigger.event] : s.trigger.event };
    const lines = s.actions.map((a) => {
      const label = ACTION_LABEL[a.type];
      if (a.type === "notify") return `${label}: «${fill(a.message, loaded.facts, extra)}»`;
      if (a.type === "followUp") return `${label} بعد ${a.inDays} يوم: «${fill(a.summary, loaded.facts, extra)}»`;
      if (a.type === "comment") return `${label}: «${fill(a.body, loaded.facts, extra)}»`;
      return `${label}: ${a.url}`;
    });
    return { ok: true, matched, facts: loaded.facts, lines };
  });
}
