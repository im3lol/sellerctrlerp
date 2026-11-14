import "server-only";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { salesPlatforms, salesOrders, platformReturns, marketplaceSettlementTxns,
  fbaReimbursements, platformRemovals, fbaLedgerEvents,returnWorkflowEvents } from "@/db/schema";
import { digest, observeReturnSource, workflowSettings } from "./store";
import type { ReturnSource } from "./model";

/** Reads the already-synchronized feeds, never credentials or remote APIs. An
 * ambiguous account/order is held as unmatched rather than assigned by channel. */
export async function captureReturnSources(orgId: string, platformId: string, from = new Date(Date.now() - 7 * 86400000)) {
  const config = await workflowSettings(orgId);
  if (config.mode === "DISABLED") return { observed: 0, unmatched: 0 };
  const [platform] = await db.select().from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.id, platformId))).limit(1);
  if (!platform||platform.code!=="AMAZON") throw new Error("This return workflow currently supports Amazon accounts only");
  const siblings = await db.select({ id: salesPlatforms.id,fulfillmentType:salesPlatforms.fulfillmentType }).from(salesPlatforms)
    .where(and(eq(salesPlatforms.organizationId, orgId), eq(salesPlatforms.code, platform.code)));
  const orders = await db.select({ external: salesOrders.externalOrderId }).from(salesOrders)
    .where(and(eq(salesOrders.organizationId, orgId), or(eq(salesOrders.platformId, platformId),
      siblings.length === 1 ? eq(salesOrders.channel, platform.code) : eq(salesOrders.platformId, platformId))));
  const orderIds = new Set(orders.map(o => o.external).filter(Boolean));
  const [returns, refunds, reimbursements, removals, ledger] = await Promise.all([
    db.select().from(platformReturns).where(and(eq(platformReturns.organizationId,orgId),eq(platformReturns.channel,platform.code),or(gte(platformReturns.createdAt,from),sql`exists(select 1 from ${returnWorkflowEvents} e where e.organization_id=${orgId} and e.kind='RETURN' and e.source_id=${platformReturns.id})`))),
    db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.channel,platform.code),eq(marketplaceSettlementTxns.type,"Refund"),
      or(gte(marketplaceSettlementTxns.postedAt,from),gte(marketplaceSettlementTxns.releaseDate,from),gte(marketplaceSettlementTxns.createdAt,from)))),
    db.select().from(fbaReimbursements).where(and(eq(fbaReimbursements.organizationId,orgId),eq(fbaReimbursements.channel,platform.code),or(gte(fbaReimbursements.createdAt,from),gte(fbaReimbursements.updatedAt,from)))),
    db.select().from(platformRemovals).where(and(eq(platformRemovals.organizationId,orgId),eq(platformRemovals.channel,platform.code),or(gte(platformRemovals.createdAt,from),gte(platformRemovals.updatedAt,from)))),
    db.select().from(fbaLedgerEvents).where(and(eq(fbaLedgerEvents.organizationId,orgId),eq(fbaLedgerEvents.channel,platform.code),or(gte(fbaLedgerEvents.createdAt,from),sql`exists(select 1 from ${returnWorkflowEvents} e where e.organization_id=${orgId} and e.kind='LEDGER' and e.source_id=${fbaLedgerEvents.id})`))),
  ]);
  let observed=0,unmatched=0;
  const capture=async(order: string|null, source: Omit<ReturnSource,"sourceVersion">)=>{
    const fba=siblings.filter(s=>s.fulfillmentType==="FBA");
    const uniqueFbaSource=!order&&["REMOVAL","REIMBURSEMENT","LEDGER"].includes(source.kind)&&fba.length===1&&fba[0].id===platformId;
    if(siblings.length>1 && (!order || !orderIds.has(order))&&!uniqueFbaSource){unmatched++;return;}
    const external=order || `${source.kind}:${source.sourceId}`;
    const {salesReturnId:_return,journalEntryId:_journal,updatedAt:_updated,status:_status,stockAdjustmentId:_stock,...facts}=source.payload;
    const canonical={...source,payload:facts};
    await observeReturnSource(orgId,platformId,external,{...canonical,sourceVersion:digest(canonical)});observed++;
  };
  for(const r of returns) await capture(r.orderId,{kind:"RETURN",sourceId:r.id,happenedAt:r.returnDate?.toISOString()??null,sourceStatus:(r.raw as {status?:string}|null)?.status??r.status,
    currency:null,quantity:r.quantity,payload:{...r,fulfillment:r.fulfillmentCenter?"FBA":(r.raw as {fulfillment?:string}|null)?.fulfillment??"UNKNOWN"}});
  for(const r of refunds) await capture(r.orderId,{kind:"REFUND",sourceId:r.id,happenedAt:r.postedAt?.toISOString()??null,sourceStatus:r.status,
    currency:r.currency,quantity:r.quantity && Number(r.quantity)>0?r.quantity:null,payload:{...r}});
  for(const r of reimbursements) await capture(r.orderId,{kind:"REIMBURSEMENT",sourceId:r.id,happenedAt:r.approvalDate?.toISOString()??null,
    sourceStatus:null,currency:r.currency,quantity:null,payload:{...r}});
  for(const r of removals) await capture(null,{kind:"REMOVAL",sourceId:r.id,happenedAt:r.requestDate?.toISOString()??null,
    sourceStatus:r.orderStatus,currency:null,quantity:r.shippedQty,payload:{...r,pendingQty:(r.raw as {pendingQty?:number}|null)?.pendingQty??0,fulfillment:"FBA"}});
  for(const r of ledger.filter(r=>/return|reimburs|adjustment|receipt/i.test(r.eventType??""))) await capture(orderIds.has(r.referenceId??"")?r.referenceId:null,{kind:"LEDGER",sourceId:r.id,happenedAt:r.eventDate?.toISOString()??null,
    sourceStatus:null,currency:null,quantity:r.quantity,payload:{...r,fulfillment:"FBA"}});
  return {observed,unmatched};
}

/** Active mode has exactly one writer for newly imported return documents. */
export async function newReturnWriterEnabled(orgId:string,channel:string){
  const config=await workflowSettings(orgId);
  return channel === "AMAZON" && config.mode !== "DISABLED" && config.cutoverAt !== null;
}
export async function workflowDocumentOwned(orgId:string,id:string){
  const {returnWorkflowOperations:ops}=await import("@/db/schema");
  const rows=await db.select({id:ops.id}).from(ops).where(and(eq(ops.organizationId,orgId),isNull(ops.reversedBy),sql`exists(select 1 from jsonb_array_elements(${ops.documents}) d where d->>'id'=${id})`)).limit(1);
  return rows.length>0;
}
