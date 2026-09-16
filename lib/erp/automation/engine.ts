import "server-only";
import { createHmac } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { withOrgScope } from "@/lib/db-scope";
import { auditLogs, automationRules, automationRuns, docComments, docFollowUps, organizationMembers } from "@/db/schema";
import { notifyUsers } from "@/lib/erp/approval-notify";
import { assertPublicUrl } from "@/lib/erp/marketplace/safe-url";
import { decryptSecret } from "@/lib/crypto";
import { cairoToday } from "@/lib/erp/chatter";
import { loadFacts } from "@/lib/erp/automation/facts";
import {
  ACTION_LABEL, DOCS, EVENT_LABEL, MAX_DEPTH, fill, isEvent, matches,
  type Action, type Facts, type Recipients, type RuleSpec,
} from "@/lib/erp/automation/model";
import { withDepth, type AutomationJob } from "@/lib/erp/automation/queue";

/**
 * The automation worker: one audited document event in, every enabled rule listening to it
 * run. Each action is tried on its own — one failing (a webhook down) doesn't stop the rest
 * — and each run is logged with a line per action.
 */

type Ctx = { orgId: string; job: AutomationJob; facts: Facts; creatorId: string | null; rule: { id: string; name: string } };

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function recipients(orgId: string, to: Recipients, creatorId: string | null): Promise<string[]> {
  const ids = new Set(to.users ?? []);
  if (to.creator && creatorId) ids.add(creatorId);
  if (to.roles?.length) {
    const rows = await db.select({ userId: organizationMembers.userId }).from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, orgId), eq(organizationMembers.isActive, true), inArray(organizationMembers.role, to.roles)));
    for (const r of rows) ids.add(r.userId);
  }
  return [...ids];
}

/** One action. Returns what it did; throws when it couldn't. */
async function runAction(a: Action, c: Ctx): Promise<string> {
  const def = DOCS[c.job.entity];
  const extra = { doc: def.label, event: isEvent(c.job.event) ? EVENT_LABEL[c.job.event] : c.job.event };
  const number = c.facts.number != null ? String(c.facts.number) : c.job.entityNumber;
  const href = number ? `${def.path}/${encodeURIComponent(number)}` : def.path;

  switch (a.type) {
    case "notify": {
      const ids = await recipients(c.orgId, a.to, c.creatorId);
      if (ids.length === 0) return "تنبيه: مفيش حد يوصله";
      await notifyUsers(c.orgId, ids, `⚙️ ${c.rule.name}`, [fill(a.message, c.facts, extra)], href);
      return `تنبيه لـ${ids.length} شخص`;
    }
    case "followUp": {
      const assignee = a.assignee === "creator" ? c.creatorId : a.assignee;
      if (!assignee) throw new Error("مفيش صاحب مستند معروف");
      await db.insert(docFollowUps).values({
        organizationId: c.orgId, kind: c.job.entity, entityId: c.job.entityId, entityNumber: number,
        summary: fill(a.summary, c.facts, extra), assignedTo: assignee, dueDate: addDays(cairoToday(), a.inDays), createdBy: null,
      });
      return `متابعة بعد ${a.inDays} يوم`;
    }
    case "comment": {
      await db.insert(docComments).values({
        organizationId: c.orgId, kind: c.job.entity, entityId: c.job.entityId, entityNumber: number,
        userId: null, body: `🤖 ${fill(a.body, c.facts, extra)}`, mentions: [],
      });
      return "تعليق اتكتب";
    }
    case "webhook": {
      await assertPublicUrl(a.url);
      const body = JSON.stringify({
        event: c.job.event, rule: c.rule, at: new Date().toISOString(),
        document: { type: c.job.entity, id: c.job.entityId, ...c.facts },
      });
      const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "SellerCtrl-Automation/1" };
      const secret = a.secret ? decryptSecret(a.secret) : null;
      if (secret) headers["x-sellerctrl-signature"] = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
      // No redirects: a public URL must not bounce the request somewhere internal.
      const res = await fetch(a.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`رد ${res.status}`);
      return `Webhook ← ${res.status}`;
    }
  }
}

/** Run a rule's actions for one document; each action on its own. */
export async function runRuleActions(ctx: Ctx, actions: Action[]): Promise<{ failed: boolean; detail: string[] }> {
  const detail: string[] = [];
  let failed = false;
  await withDepth(ctx.job.depth + 1, async () => {
    for (const a of actions) {
      try {
        // A webhook needs no database — keep it out of the transaction.
        detail.push(a.type === "webhook" ? await runAction(a, ctx) : await withOrgScope(ctx.orgId, false, () => runAction(a, ctx)));
      } catch (e) {
        failed = true;
        detail.push(`${ACTION_LABEL[a.type]}: فشل — ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
      }
    }
  });
  return { failed, detail };
}

/** Worker entry point. `lastAttempt` decides whether a not-yet-visible audit row is retried or dropped. */
export async function runAutomationJob(orgId: string, job: AutomationJob, lastAttempt: boolean): Promise<void> {
  if (job.depth > MAX_DEPTH) return;

  const work = await withOrgScope(orgId, false, async () => {
    // The event is real only once its audit row committed (a rolled-back action never does).
    const [audit] = await db.select({ id: auditLogs.id }).from(auditLogs)
      .where(and(eq(auditLogs.id, job.auditId), eq(auditLogs.organizationId, orgId))).limit(1);
    if (!audit) return "missing" as const;

    const rules = await db.select({ id: automationRules.id, name: automationRules.name, spec: automationRules.spec })
      .from(automationRules)
      .where(and(
        eq(automationRules.organizationId, orgId), eq(automationRules.enabled, true),
        sql`${automationRules.spec}->'trigger'->>'entity' = ${job.entity}`,
        sql`${automationRules.spec}->'trigger'->>'event' = ${job.event}`,
      ));
    if (rules.length === 0) return null;
    const loaded = await loadFacts(orgId, job.entity, job.entityId);
    return { rules, facts: loaded?.facts ?? { number: job.entityNumber }, creatorId: loaded?.creatorId ?? null };
  });

  if (work === "missing") {
    if (!lastAttempt) throw new Error("audit row not committed yet");
    return;
  }
  if (!work) return;

  for (const r of work.rules) {
    const spec = r.spec as RuleSpec;
    if (!matches(spec, work.facts)) continue;
    const { failed, detail } = await runRuleActions(
      { orgId, job, facts: work.facts, creatorId: work.creatorId, rule: { id: r.id, name: r.name } }, spec.actions);
    await withOrgScope(orgId, false, async () => {
      await db.insert(automationRuns).values({
        organizationId: orgId, ruleId: r.id, entityType: job.entity, entityId: job.entityId,
        entityNumber: work.facts.number != null ? String(work.facts.number) : job.entityNumber,
        event: job.event, status: failed ? "FAILED" : "DONE", detail,
      });
      await db.update(automationRules)
        .set({ runCount: sql`${automationRules.runCount} + 1`, lastRunAt: new Date() })
        .where(eq(automationRules.id, r.id));
    });
  }
}
