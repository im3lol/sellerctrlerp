import "server-only";
import {and,desc,eq,inArray,or,sql} from "drizzle-orm";
import {db} from "@/lib/db";
import {returnWorkflowEvents as events,returnWorkflowCases as cases} from "@/db/schema";
import type {ReturnCaseState} from "./model";

/** Evidence can be linked by an audited decision without rewriting its source case. */
export async function caseEvidence(orgId:string,caseId:string,state:ReturnCaseState,id:string){
 const [event]=await db.select({event:events}).from(events).innerJoin(cases,and(eq(cases.id,events.caseId),eq(cases.organizationId,orgId)))
  .where(and(eq(events.organizationId,orgId),eq(events.id,id),or(eq(events.caseId,caseId),
   state.evidenceIds?.length?inArray(events.id,state.evidenceIds):eq(events.caseId,caseId)))).limit(1);
 if(!event)throw new Error("Evidence is not allocated to this return case");
 await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${orgId+":"+event.event.kind+":"+event.event.sourceId},0))`);
 const [latest]=await db.select({id:events.id}).from(events).where(and(eq(events.organizationId,orgId),eq(events.kind,event.event.kind),eq(events.sourceId,event.event.sourceId))).orderBy(desc(events.createdAt)).limit(1);
 if(latest?.id!==id)throw new Error("Source evidence was revised; review the latest version");
 return event.event;
}
