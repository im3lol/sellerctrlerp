"use server";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { withOrgScope,withPlatformScope } from "@/lib/db-scope";
import { authorizeErp } from "@/lib/erp/action-auth";
import type { ErpPermission } from "@/lib/erp/permissions";
import { revalidatePath } from "@/lib/safe-revalidate";
import { returnWorkflowSettings as settings, returnWorkflowCases as cases, returnWorkflowEvents as events,returnWorkflowOperations as operations,items,
  salesInvoices, salesInvoiceLines, salesOrders, deliveryNotes, salesPlatforms, warehouses, stockMovements,stockAdjustments,journalEntries } from "@/db/schema";
import { listReturnCases, returnCaseDetail, workflowSettings, executeReturnOperation } from "@/lib/erp/return-workflow/store";
import { captureReturnSources } from "@/lib/erp/return-workflow/sources";
import { applyReturnFinance, type FinanceDecision } from "@/lib/erp/return-workflow/finance";
import { applyReturnReceipt, type ReceiptDecision } from "@/lib/erp/return-workflow/inventory";
import {applyReturnTransfer,type TransferDecision}from "@/lib/erp/return-workflow/transfers";
import {applyReimbursement,type ReimbursementDecision}from "@/lib/erp/return-workflow/reimbursements";
import {applyReturnWriteOff,type WriteOffDecision}from "@/lib/erp/return-workflow/write-offs";
import {reverseReturnOperation}from "@/lib/erp/return-workflow/reverse";
import { caseClosure, scaled, type ReturnOperationKind } from "@/lib/erp/return-workflow/model";
import {recordAudit}from "@/lib/erp/audit";
import {getErpContext}from "@/lib/erp/erp-context";
import {getActiveOrg}from "@/lib/erp/org";
import {getMemberAccess}from "@/lib/erp/auth-guard";

const ident=z.string().trim().min(1).max(200);
const qty=z.string().regex(/^\d+(?:\.\d{1,4})?$/).max(25);
const evidence=z.string().trim().min(5).max(3000);
const command=z.object({caseId:ident,key:z.string().uuid(),version:z.number().int().positive(),kind:z.enum([
  "MATCH","FINANCIAL","RECEIPT","TRANSFER","WRITE_OFF","WAIVE_RETURN","CLAIM","REIMBURSEMENT","FEES","EXCEPTION","REOPEN","REVERSE"]),payload:z.record(z.string(),z.unknown())});
const permission:Record<ReturnOperationKind,ErpPermission>={MATCH:"sales.confirm",FINANCIAL:"accounting.post",RECEIPT:"inventory.confirm",
  TRANSFER:"inventory.confirm",WRITE_OFF:"accounting.post",WAIVE_RETURN:"approvals.decide",CLAIM:"sales.confirm",REIMBURSEMENT:"accounting.post",
  FEES:"accounting.post",EXCEPTION:"approvals.decide",REOPEN:"approvals.decide",REVERSE:"accounting.reverse"};

export async function getReturnWorkspaceAction(caseId?:string,page=1){
 page=z.number().int().min(1).max(100000).catch(1).parse(page);
 const auth=await authorizeErp("sales.view","marketplace");if("error"in auth)return auth;
 const permissions=getErpContext()?.permissions??await withPlatformScope(async()=>{const {user}=await getActiveOrg();return user?(await getMemberAccess(auth.orgId,user)).permissions:new Set<ErpPermission>();});
 const finance=permissions.has("accounting.view")?{}:{error:"forbidden"};
 const capabilities:Partial<Record<ReturnOperationKind,boolean>>={};
 for(const [kind,p]of Object.entries(permission))capabilities[kind as ReturnOperationKind]=permissions.has(p);
 return withOrgScope(auth.orgId,false,async()=>{
  const [config,list,platforms,wh]=await Promise.all([workflowSettings(auth.orgId),listReturnCases(auth.orgId,page),
   db.select({id:salesPlatforms.id,name:salesPlatforms.name}).from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,auth.orgId),eq(salesPlatforms.code,"AMAZON"))),
   db.select({id:warehouses.id,name:warehouses.nameAr}).from(warehouses).where(and(eq(warehouses.organizationId,auth.orgId),eq(warehouses.isActive,true)))]);
  const storedDetail=caseId?await returnCaseDetail(auth.orgId,caseId):null;
  const evidencePool=storedDetail?await db.select({id:events.id,kind:events.kind,sourceId:events.sourceId,quantity:events.quantity,payload:events.payload}).from(events)
   .innerJoin(cases,and(eq(cases.id,events.caseId),eq(cases.organizationId,auth.orgId)))
   .where(and(eq(events.organizationId,auth.orgId),eq(cases.platformId,storedDetail.record.platformId),inArray(events.kind,["LEDGER","REIMBURSEMENT"]))).limit(250):[];
  const losses=storedDetail?await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,auth.orgId),eq(stockMovements.type,"OUT"),eq(stockMovements.referenceType,"STOCK_ADJUSTMENT"))).limit(100):[];
  const itemList=await db.select({id:items.id,code:items.code,name:items.nameAr}).from(items).where(and(eq(items.organizationId,auth.orgId),eq(items.isActive,true))).limit(2000);
  const detail=storedDetail?{...storedDetail,operations:storedDetail.operations.map(({beforeState:_before,...operation})=>operation)}:null;
  const available=detail?await db.select({invoiceId:salesInvoices.id,invoiceNumber:salesInvoices.number,lineId:salesInvoiceLines.id,
   itemId:salesInvoiceLines.itemId,quantity:salesInvoiceLines.quantity,deliveryId:salesInvoices.deliveryNoteId})
   .from(salesInvoiceLines).innerJoin(salesInvoices,eq(salesInvoices.id,salesInvoiceLines.salesInvoiceId))
   .leftJoin(deliveryNotes,eq(deliveryNotes.id,salesInvoices.deliveryNoteId))
   .innerJoin(salesOrders,or(eq(salesOrders.id,salesInvoices.salesOrderId),eq(salesOrders.id,deliveryNotes.salesOrderId)))
   .where(and(eq(salesInvoices.organizationId,auth.orgId),eq(salesOrders.organizationId,auth.orgId),
     eq(salesOrders.externalOrderId,detail.record.externalOrderId),eq(salesOrders.platformId,detail.record.platformId),
     inArray(salesInvoices.status,["POSTED","PARTIAL_PAID","PAID"]))):[];
  const moves=detail&&detail.record.state.lines.length?await db.select().from(stockMovements)
   .where(and(eq(stockMovements.organizationId,auth.orgId),eq(stockMovements.type,"OUT"),
    inArray(stockMovements.referenceId,[...new Set(detail.record.state.lines.map(l=>l.deliveryId??l.invoiceId))]))):[];
  const visibleDetail=detail&&"error"in finance?{...detail,
   record:{...detail.record,state:{...detail.record.state,claims:detail.record.state.claims.map(c=>({...c,expectedAmount:null,acceptedAmount:null}))}},
   events:detail.events.filter(e=>!["REFUND","REIMBURSEMENT"].includes(e.kind)),
   operations:detail.operations.map(o=>["FINANCIAL","REIMBURSEMENT","FEES"].includes(o.kind)?{...o,payload:{}}:o)}:detail;
  return {page,config,list:list.map(r=>({...r,state:"error"in finance?{...r.state,claims:r.state.claims.map(c=>({...c,expectedAmount:null,acceptedAmount:null}))}:r.state,closure:caseClosure(r.state)})),
   platforms,warehouses:wh,items:itemList,losses,evidencePool:evidencePool.filter(e=>!("error"in finance)||e.kind!=="REIMBURSEMENT").map(e=>({...e,payload:undefined})),detail:visibleDetail,available,movements:moves,capabilities,canFinance:!("error"in finance),canConfigure:permissions.has("settings.edit")&&permissions.has("approvals.decide")};
 });
}

export async function configureReturnWorkflowAction(input:unknown){
 const auth=await authorizeErp("settings.edit","marketplace");if("error"in auth)return auth;
 const manager=await authorizeErp("approvals.decide","marketplace");if("error"in manager)return manager;
 const p=z.object({mode:z.enum(["MONITOR","MANUAL","DISABLED"]),acknowledged:z.boolean()}).safeParse(input);
 if(!p.success||!p.data.acknowledged)return {error:"Confirm the observation/cutover policy first"};
 return withOrgScope(auth.orgId,false,async()=>{
  const prior=await workflowSettings(auth.orgId);
  if(p.data.mode==="DISABLED"&&prior.cutoverAt)return {error:"Disable posting by returning to MONITOR; the legacy writer must not resume"};
  await db.insert(settings).values({organizationId:auth.orgId,mode:p.data.mode,cutoverAt:p.data.mode==="MANUAL"?prior.cutoverAt??new Date():prior.cutoverAt,updatedBy:auth.userId})
   .onConflictDoUpdate({target:settings.organizationId,set:{mode:p.data.mode,cutoverAt:p.data.mode==="MANUAL"?prior.cutoverAt??new Date():prior.cutoverAt,updatedBy:auth.userId,updatedAt:new Date()}});
  const {scopeStore}=await import("@/lib/db");
  await recordAudit(scopeStore.getStore()!.tx,{orgId:auth.orgId,userId:auth.userId,action:"UPDATE",entityType:"RETURN_WORKFLOW",entityId:auth.orgId,summary:"Return workflow mode changed",metadata:{from:prior.mode,to:p.data.mode}});
  revalidatePath("/sales/marketplace-returns");return {ok:true};
 });
}
export async function captureReturnSourcesAction(platformId:string){
 const auth=await authorizeErp("sales.view","marketplace");if("error"in auth)return auth;
 try{return await withOrgScope(auth.orgId,false,async()=>({ok:true,...await captureReturnSources(auth.orgId,ident.parse(platformId))}));}
 catch{return {error:"Unable to refresh return evidence; existing data remains unchanged"};}
}

export async function executeReturnWorkflowAction(input:unknown){
 const p=command.safeParse(input);if(!p.success)return {error:"Invalid return request"};
 const cmd=p.data;const auth=await authorizeErp(permission[cmd.kind],"marketplace");if("error"in auth)return auth;
 try{
  const result=await withOrgScope(auth.orgId,false,()=>executeReturnOperation({...cmd,orgId:auth.orgId,userId:auth.userId},async (record,operationId)=>{
   const state=structuredClone(record.state);
   if(cmd.kind==="MATCH"){
    if(cmd.payload.mode==="LOSS"){
     const d=z.object({movementId:ident,evidence}).parse(cmd.payload);
     const [move]=await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,auth.orgId),eq(stockMovements.id,d.movementId),eq(stockMovements.type,"OUT"),eq(stockMovements.referenceType,"STOCK_ADJUSTMENT"))).limit(1);
     const [platform]=await db.select().from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,auth.orgId),eq(salesPlatforms.id,record.platformId))).limit(1);
     if(!move||!move.referenceId||move.warehouseId!==platform?.defaultWarehouseId)throw new Error("The loss must belong to this account's FBA warehouse");
     const [adjustment]=await db.select().from(stockAdjustments).where(and(eq(stockAdjustments.organizationId,auth.orgId),eq(stockAdjustments.id,move.referenceId),eq(stockAdjustments.status,"POSTED"))).limit(1);
     const journals=await db.select().from(journalEntries).where(and(eq(journalEntries.organizationId,auth.orgId),eq(journalEntries.sourceId,move.referenceId),eq(journalEntries.status,"POSTED")));
     if(!adjustment||!journals.some(j=>!j.reversedById))throw new Error("An existing posted stock loss and journal are required");
     return {state:{...state,matched:true,lossMovementIds:[...new Set([...(state.lossMovementIds??[]),move.id])],inventoryExemptReason:d.evidence}};
    }
    if(cmd.payload.mode==="EVIDENCE"){
     const d=z.object({eventIds:z.array(ident).min(1).max(30),evidence}).parse(cmd.payload);
     const found=await db.select({event:events}).from(events).innerJoin(cases,and(eq(cases.id,events.caseId),eq(cases.organizationId,auth.orgId)))
      .where(and(eq(events.organizationId,auth.orgId),eq(cases.platformId,record.platformId),inArray(events.id,d.eventIds),inArray(events.kind,["LEDGER","REIMBURSEMENT"])));
     if(found.length!==new Set(d.eventIds).size)throw new Error("Invalid same-account evidence allocation");
     return {state:{...state,evidenceIds:[...new Set([...(state.evidenceIds??[]),...d.eventIds])]}};
    }
    const d=z.object({invoiceLineIds:z.array(ident).min(1),expected:z.record(z.string(),qty.nullable()),fulfillment:z.enum(["FBA","MFN","UNKNOWN"]),evidence}).parse(cmd.payload);
    if(state.financial!=="PENDING"||state.lines.some(l=>Number(l.receivedQuantity)>0))throw new Error("An active allocation cannot be replaced; reopen and reverse it first");
    const records=await db.select({invoice:salesInvoices,line:salesInvoiceLines,order:salesOrders}).from(salesInvoiceLines)
     .innerJoin(salesInvoices,eq(salesInvoices.id,salesInvoiceLines.salesInvoiceId))
     .leftJoin(deliveryNotes,eq(deliveryNotes.id,salesInvoices.deliveryNoteId))
     .innerJoin(salesOrders,or(eq(salesOrders.id,salesInvoices.salesOrderId),eq(salesOrders.id,deliveryNotes.salesOrderId)))
     .where(and(eq(salesInvoices.organizationId,auth.orgId),eq(salesOrders.organizationId,auth.orgId),
       eq(salesOrders.externalOrderId,record.externalOrderId),eq(salesOrders.platformId,record.platformId),inArray(salesInvoiceLines.id,d.invoiceLineIds),
       inArray(salesInvoices.status,["POSTED","PARTIAL_PAID","PAID"])));
    if(records.length!==new Set(d.invoiceLineIds).size)throw new Error("The selected invoice lines do not belong to this order/account");
    const lines=records.map(r=>{const expected=d.expected[r.line.id]??null;
     if(expected!==null&&scaled(expected)>scaled(r.line.quantity))throw new Error("Expected return quantity exceeds the original sale");
     return {id:r.line.id,itemId:r.line.itemId,invoiceId:r.invoice.id,invoiceLineId:r.line.id,deliveryId:r.invoice.deliveryNoteId,
      soldQuantity:r.line.quantity,expectedQuantity:expected,receivedQuantity:"0",waivedQuantity:"0",writtenOffQuantity:"0"};});
    return {state:{...state,matched:true,fulfillment:d.fulfillment,invoiceIds:[...new Set(records.map(r=>r.invoice.id))],lines,exception:null}};
   }
   if(cmd.kind==="FINANCIAL"){
    const d=z.object({phase:z.enum(["CREDIT","SETTLEMENT"]),eventId:ident,invoiceId:ident,lineId:ident,
     parts:z.object({principal:qty,discount:qty,tax:qty,shipping:qty}),quantity:qty.nullable(),
     allocations:z.array(z.object({invoiceId:ident,lineId:ident,parts:z.object({principal:qty,discount:qty,tax:qty,shipping:qty}),quantity:qty.nullable()})).max(100).optional(),
     date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),evidence,verified:z.boolean()}).parse(cmd.payload);
    const r=await applyReturnFinance(auth.orgId,auth.userId,record.id,state,d as FinanceDecision,operationId);
    // Canonical source identity stays in the operation for replays and phase allocation.
    cmd.payload.sourceId=r.sourceId;cmd.payload.phase=d.phase;cmd.payload.decision=d;
    return r;
   }
   if(cmd.kind==="RECEIPT"){
    const d=z.object({lineId:ident,quantity:qty,movementId:ident,warehouseId:ident,condition:z.enum(["SELLABLE","QUARANTINE","WRITE_OFF"]),
     location:z.enum(["AMAZON","LOCAL"]),eventIds:z.array(ident),evidence,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(cmd.payload);
    if(d.condition==="WRITE_OFF"){const extra=await authorizeErp("accounting.post","marketplace");if("error"in extra)throw new Error(extra.error);}
    return applyReturnReceipt(auth.orgId,auth.userId,record.id,state,d as ReceiptDecision);
   }
   if(cmd.kind==="TRANSFER"){
    const d=z.object({phase:z.enum(["DISPATCH","RECEIVE"]),eventId:ident.optional(),transferId:ident.optional(),itemId:ident,
     fromWarehouseId:ident,transitWarehouseId:ident,destinationWarehouseId:ident,quantity:qty,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),evidence}).parse(cmd.payload);
    const r=await applyReturnTransfer(auth.orgId,auth.userId,record.id,record.platformId,state,d as TransferDecision);
    cmd.payload.sourceId=r.sourceId;cmd.payload.transferId=r.transferId;return r;
   }
   if(cmd.kind==="REIMBURSEMENT"){
    const d=z.object({mode:z.enum(["CASH_LINK","INVENTORY"]),eventId:ident,claimId:ident,amount:qty,quantity:qty,
     settlementId:ident.optional(),warehouseId:ident.optional(),itemId:ident.optional(),originalMovementId:ident.optional(),inventoryEvidenceId:ident.optional(),
     date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),evidence}).parse(cmd.payload);
    if(d.mode==="INVENTORY"){const extra=await authorizeErp("inventory.confirm","marketplace");if("error"in extra)throw new Error(extra.error);}
    const r=await applyReimbursement(auth.orgId,auth.userId,record.id,state,d as ReimbursementDecision);cmd.payload.sourceId=r.sourceId;return r;
   }
   if(cmd.kind==="FEES"){
    const d=z.object({financialNotRequired:z.boolean(),feesNotRequired:z.boolean(),evidence}).parse(cmd.payload);
    const refunds=await db.select({id:events.id}).from(events).where(and(eq(events.organizationId,auth.orgId),eq(events.caseId,record.id),eq(events.kind,"REFUND"))).limit(1);
    if(refunds.length)throw new Error("A financial refund source exists; reconcile it instead of exempting it");
    if(d.financialNotRequired){state.financial="EXEMPT";state.financialReason=d.evidence;}
    if(d.feesNotRequired){state.fees="EXEMPT";state.feeReason=d.evidence;}
    return {state};
   }
   if(cmd.kind==="WRITE_OFF"){
    const extra=await authorizeErp("inventory.confirm","marketplace");if("error"in extra)throw new Error(extra.error);
    const d=z.object({mode:z.enum(["TRANSIT_LOSS","DISPOSAL"]),eventId:ident.optional(),transferId:ident.optional(),itemId:ident,quantity:qty,
     date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),evidence}).parse(cmd.payload);
    const r=await applyReturnWriteOff(auth.orgId,auth.userId,record.id,record.platformId,state,d as WriteOffDecision);cmd.payload.sourceId=r.sourceId;return r;
   }
   if(cmd.kind==="REVERSE"){
    const d=z.object({operationId:ident,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),evidence}).parse(cmd.payload);
    const [target]=await db.select().from(operations).where(and(eq(operations.organizationId,auth.orgId),eq(operations.caseId,record.id),eq(operations.id,d.operationId))).limit(1);
    if(target?.documents.some(doc=>["STOCK_MOVEMENT","STOCK_RETURN","STOCK_TRANSFER","STOCK_ADJUSTMENT"].includes(doc.type))){const extra=await authorizeErp("inventory.confirm","marketplace");if("error"in extra)throw new Error(extra.error);}
    return reverseReturnOperation(auth.orgId,auth.userId,record.id,operationId,d.operationId,d.date,d.evidence);
   }
   if(cmd.kind==="WAIVE_RETURN"){
    const d=z.object({lineId:ident,quantity:qty,evidence}).parse(cmd.payload);const line=state.lines.find(l=>l.id===d.lineId);
    if(!line||line.expectedQuantity===null||scaled(d.quantity)<=BigInt(0)||scaled(line.receivedQuantity)+scaled(line.waivedQuantity)+scaled(d.quantity)>scaled(line.expectedQuantity))throw new Error("Invalid waived quantity");
    const {decimal}=await import("@/lib/erp/return-workflow/model");
    line.waivedQuantity=decimal(scaled(line.waivedQuantity)+scaled(d.quantity));return {state};
   }
   if(cmd.kind==="CLAIM"){
    const d=z.object({id:ident.optional(),lineId:ident.nullable(),reference:ident.nullable(),reason:evidence,
     state:z.enum(["REVIEW","SUBMITTED","ACCEPTED","REJECTED","CLOSED"]),expectedAmount:qty.nullable(),acceptedAmount:qty.nullable(),
     currency:z.string().regex(/^[A-Z]{3}$/),expectedQuantity:qty.nullable().optional(),evidence,decisionReason:evidence.optional()}).parse(cmd.payload);
    if(d.lineId&&!state.lines.some(l=>l.id===d.lineId))throw new Error("Claim line does not belong to this case");
    if(d.state==="CLOSED"&&!d.decisionReason)throw new Error("Closing a claim requires an explicit reason");
    if(d.state==="CLOSED"){const extra=await authorizeErp("approvals.decide","marketplace");if("error"in extra)throw new Error(extra.error);}
    const old=state.claims.find(c=>c.id===d.id);
    const claim={...old,...d,id:d.id??randomUUID()};
    if(d.id&&!state.claims.some(c=>c.id===d.id))throw new Error("Claim not found");
    state.claims=[...state.claims.filter(c=>c.id!==claim.id),claim];return {state};
   }
   if(cmd.kind==="EXCEPTION"||cmd.kind==="REOPEN"){
    const d=z.object({reason:evidence,clear:z.boolean().optional()}).parse(cmd.payload);
    state.exception=d.clear?null:d.reason;return {state};
   }
   throw new Error("This operation needs its dedicated document preview before it can be approved");
  }));
  revalidatePath("/sales/marketplace-returns");return {ok:true,...result};
 }catch(e){return {error:e instanceof z.ZodError?"Invalid return decision":e instanceof Error&&!("code"in e)?e.message:"Unable to process the return; no partial changes were committed"};}
}
