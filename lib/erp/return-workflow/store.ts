import "server-only";
import { createHash,randomUUID } from "node:crypto";
import { and, desc, eq, inArray,or,sql } from "drizzle-orm";
import { db, scopeStore } from "@/lib/db";
import { returnWorkflowSettings as settings, returnWorkflowCases as cases,
  returnWorkflowEvents as events, returnWorkflowOperations as operations, salesPlatforms } from "@/db/schema";
import { recordAudit } from "@/lib/erp/audit";
import { emptyCaseState, type ReturnOperationKind, type ReturnCaseState, type ReturnSource } from "./model";
import { projectReturnState } from "./projection";

export const digest = (input: unknown) => createHash("sha256").update(JSON.stringify(input)).digest("hex");
export async function workflowSettings(orgId: string) {
  return (await db.select().from(settings).where(eq(settings.organizationId, orgId)).limit(1))[0]
    ?? { organizationId: orgId, mode: "DISABLED" as const, cutoverAt: null, updatedBy: null, updatedAt: new Date(0) };
}
export async function listReturnCases(orgId: string,page=1) {
  const list=await db.select().from(cases).where(and(eq(cases.organizationId, orgId),sql`${cases.externalOrderId} not like 'LEDGER:%'`)).orderBy(desc(cases.updatedAt),desc(cases.id)).limit(200).offset((page-1)*200);
  if(!list.length)return list;
  const ids=list.map(c=>c.id);
  const [e,o]=await Promise.all([db.select().from(events).where(and(eq(events.organizationId,orgId),inArray(events.caseId,ids))).orderBy(desc(events.createdAt)),db.select().from(operations).where(and(eq(operations.organizationId,orgId),inArray(operations.caseId,ids)))]);
  return list.map(c=>({...c,state:projectReturnState(c.state,e.filter(s=>s.caseId===c.id),o.filter(s=>s.caseId===c.id))}));
}
export async function returnCaseDetail(orgId: string, caseId: string) {
  const [record] = await db.select().from(cases).where(and(eq(cases.organizationId, orgId), eq(cases.id, caseId))).limit(1);
  if (!record) throw new Error("Return case not found");
  const [e, o] = await Promise.all([
    db.select().from(events).where(and(eq(events.organizationId, orgId),or(eq(events.caseId,caseId),record.state.evidenceIds?.length?inArray(events.id,record.state.evidenceIds):eq(events.caseId,caseId)))).orderBy(desc(events.createdAt)),
    db.select().from(operations).where(and(eq(operations.organizationId, orgId), eq(operations.caseId, caseId))).orderBy(desc(operations.createdAt)),
  ]);
  return { record:{...record,state:projectReturnState(record.state,e,o)}, events: e, operations: o };
}

/** Source imports are observations only. No source status is overwritten, no ERP
 * document is posted and late revisions explicitly reopen an exception. */
export async function observeReturnSource(orgId: string, platformId: string, externalOrderId: string, source: ReturnSource) {
  const config = await workflowSettings(orgId);
  if (config.mode === "DISABLED") return null;
  const [platform] = await db.select({ id: salesPlatforms.id }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.id, platformId))).limit(1);
  if (!platform) throw new Error("Invalid return platform");
  const state = emptyCaseState(source.payload.fulfillment === "FBA" ? "FBA" : source.payload.fulfillment === "MFN" ? "MFN" : "UNKNOWN");
  const [record] = await db.insert(cases).values({ organizationId: orgId, platformId, externalOrderId, state,
    origin: source.happenedAt && config.cutoverAt && new Date(source.happenedAt) >= config.cutoverAt ? "CURRENT" : "LEGACY" })
    .onConflictDoUpdate({ target: [cases.organizationId, cases.platformId, cases.externalOrderId], set: { updatedAt: new Date() } }).returning();
  const inserted = await db.insert(events).values({ organizationId: orgId, caseId: record.id, ...source,
    happenedAt: source.happenedAt ? new Date(source.happenedAt) : null })
    .onConflictDoNothing({ target: [events.organizationId, events.kind, events.sourceId, events.sourceVersion] }).returning({ id: events.id });
  if (inserted.length && record.state.matched) {
    await db.execute(sql`update return_workflow_cases set state=jsonb_set(state,'{exception}',to_jsonb('New source evidence requires review'::text)),version=version+1,updated_at=now() where organization_id=${orgId} and id=${record.id}`);
  }
  return record.id;
}

type Case = typeof cases.$inferSelect;
type DocumentRef = { type: string; id: string };
/** A nested transaction gets its own ALS handle, so ALL reused services (including
 * those importing db rather than tx) participate in this savepoint/rollback. */
export async function executeReturnOperation<T extends Record<string, unknown>>(input: {
  orgId: string; userId: string; caseId: string; key: string; version: number;
  kind: ReturnOperationKind; payload: T;
}, apply: (record: Case,operationId:string) => Promise<{ state: ReturnCaseState; documents?: DocumentRef[] }>) {
  const scope = scopeStore.getStore();
  if (!scope || scope.isPlatform || scope.orgId !== input.orgId) throw new Error("A tenant transaction is required");
  return db.transaction(async tx => scopeStore.run({ ...scope, tx }, async () => {
    const [record] = await db.select().from(cases).where(and(eq(cases.organizationId, input.orgId), eq(cases.id, input.caseId))).for("update");
    if (!record) throw new Error("Return case not found");
    const hash = digest({ kind: input.kind, payload: input.payload });
    const [existing] = await db.select().from(operations).where(and(eq(operations.organizationId, input.orgId), eq(operations.caseId, input.caseId), eq(operations.key, input.key))).limit(1);
    if (existing) {
      if (existing.inputHash !== hash) throw new Error("Idempotency key was reused with different data");
      return { id: existing.id, documents: existing.documents, replay: true };
    }
    const config = await workflowSettings(input.orgId);
    if (config.mode === "DISABLED" || (config.mode !== "MANUAL" && !["MATCH","CLAIM","EXCEPTION","REOPEN"].includes(input.kind))) {
      throw new Error("Return workflow is in observation mode; posting is disabled");
    }
    if (record.version !== input.version) throw new Error("Return case changed; refresh the preview");
    const operationId=randomUUID();
    const result = await apply(record,operationId);
    const [operation] = await db.insert(operations).values({ id:operationId,organizationId: input.orgId, caseId: record.id, key: input.key,
      kind: input.kind, inputHash: hash, payload: input.payload,beforeState:record.state,caseVersion:record.version, documents: result.documents ?? [], userId: input.userId }).returning({ id: operations.id });
    const allEvents=await db.select().from(events).where(and(eq(events.organizationId,input.orgId),eq(events.caseId,record.id))).orderBy(desc(events.createdAt));
    const allOperations=await db.select().from(operations).where(and(eq(operations.organizationId,input.orgId),eq(operations.caseId,record.id)));
    await db.update(cases).set({ state: projectReturnState(result.state,allEvents,allOperations), version: record.version + 1, updatedAt: new Date() })
      .where(and(eq(cases.organizationId, input.orgId), eq(cases.id, record.id)));
    await recordAudit(tx, { orgId: input.orgId, userId: input.userId, action: "CONFIRM", entityType: "RETURN_CASE", entityId: record.id,
      summary: `Return workflow ${input.kind}`, metadata: { operationId: operation.id, key: input.key } });
    return { id: operation.id, documents: result.documents ?? [], replay: false };
  }));
}
