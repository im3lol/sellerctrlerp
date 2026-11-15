import "server-only";
import {and,eq,gt}from "drizzle-orm";
import {db,scopeStore}from "@/lib/db";
import {returnWorkflowOperations as operations,stockMovements,stockMovementBatches,stockBatches,salesReturns,salesInvoices,
 customers,marketplaceSettlementTxns,stockTransfers,stockAdjustments}from "@/db/schema";
import {sql}from "drizzle-orm";
import {reverseEntry}from "@/lib/erp/posting";
import {postStockMovement}from "@/lib/erp/inventory";
import {workflowSettings}from "./store";
export async function reverseReturnOperation(orgId:string,userId:string,caseId:string,operationId:string,targetId:string,dateString:string,reason:string){
 if(reason.trim().length<5)throw new Error("A reversal reason is required");
 const date=new Date(dateString+"T12:00:00Z"),config=await workflowSettings(orgId);
 if(!Number.isFinite(date.getTime())||!config.cutoverAt||dateString<config.cutoverAt.toISOString().slice(0,10))throw new Error("Historical reversal date is not allowed");
 const [target]=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.caseId,caseId),eq(operations.id,targetId))).for("update");
 if(!target||target.reversedBy||target.kind==="REVERSE")throw new Error("The decision cannot be reversed");
 const later=await db.select({id:operations.id}).from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.caseId,caseId),gt(operations.caseVersion,target.caseVersion)));
 const all=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.caseId,caseId)));
 if(later.some(l=>all.some(o=>o.id===l.id&&!o.reversedBy&&o.kind!=="REVERSE")))throw new Error("Reverse dependent later decisions first");
 const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
 const documents:{type:string;id:string}[]=[];
 const cashLink=target.kind==="REIMBURSEMENT"&&target.payload.mode==="CASH_LINK";
 if(!cashLink){
  for(const ref of [...target.documents].reverse()){
   if(ref.type==="STOCK_MOVEMENT"){
    const [m]=await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,orgId),eq(stockMovements.id,ref.id))).for("update");
    if(!m||!["IN","OUT"].includes(m.type))throw new Error("Unsupported stock reversal");
    const batches=await db.select({batchId:stockMovementBatches.batchId,quantity:stockMovementBatches.quantity,remaining:stockBatches.remainingQuantity})
     .from(stockMovementBatches).innerJoin(stockBatches,eq(stockBatches.id,stockMovementBatches.batchId))
     .where(and(eq(stockMovementBatches.organizationId,orgId),eq(stockMovementBatches.movementId,m.id)));
    if(m.type==="IN"&&batches.some(b=>Number(b.remaining)<Math.abs(Number(b.quantity))))throw new Error("Returned inventory has already been consumed; use an approved quantity correction");
    const inverse=await postStockMovement(scope.tx,{orgId,itemId:m.itemId,warehouseId:m.warehouseId,type:m.type==="IN"?"OUT":"IN",quantity:Number(m.quantity),unitCost:Number(m.unitCost),date,
     allocations:batches.map(b=>({batchId:b.batchId,quantity:Math.abs(Number(b.quantity))})),referenceType:"RETURN_OPERATION_REVERSE",referenceId:operationId,reason});
    if(Math.abs(inverse.totalCost-Number(m.totalCost))>0.0001)throw new Error("Stock cost changed; an explicit valuation correction is required before reversal");
    documents.push({type:"STOCK_MOVEMENT",id:inverse.movementId});
   }
   if(ref.type==="JOURNAL"){
    const id=await reverseEntry(scope.tx,{orgId,entryId:ref.id,date,userId,reason});documents.push({type:"JOURNAL",id});
   }
   if(ref.type==="STOCK_RETURN")await db.update(salesReturns).set({status:"CANCELLED"}).where(and(eq(salesReturns.organizationId,orgId),eq(salesReturns.id,ref.id)));
   if(ref.type==="STOCK_TRANSFER")await db.update(stockTransfers).set({status:"REVERSED"}).where(and(eq(stockTransfers.organizationId,orgId),eq(stockTransfers.id,ref.id)));
   if(ref.type==="STOCK_ADJUSTMENT")await db.update(stockAdjustments).set({status:"CANCELLED"}).where(and(eq(stockAdjustments.organizationId,orgId),eq(stockAdjustments.id,ref.id)));
  }
 }
 if(target.kind==="FINANCIAL"){
  const phase=String(target.payload.phase),sourceId=String(target.payload.sourceId);
  const [source]=await db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.id,sourceId))).for("update");
  if(!source)throw new Error("Original refund source is unavailable");
  const creditOperation=phase==="CREDIT"?target:all.find(o=>!o.reversedBy&&o.kind==="FINANCIAL"&&o.payload.phase==="CREDIT"&&o.payload.sourceId===sourceId);
  if(!creditOperation)throw new Error("Original credit decision is unavailable");
  for(const ref of creditOperation.documents.filter(d=>d.type==="SALES_RETURN")){
   const [ret]=await db.select().from(salesReturns).where(and(eq(salesReturns.organizationId,orgId),eq(salesReturns.id,ref.id))).for("update");
   if(!ret||!ret.salesInvoiceId)throw new Error("Original credit note is unavailable");
   const amount=Number(ret.totalAmount);
   const [inv]=await db.select({id:salesInvoices.id}).from(salesInvoices).where(and(eq(salesInvoices.organizationId,orgId),eq(salesInvoices.id,ret.salesInvoiceId))).for("update");
   if(!inv)throw new Error("Original invoice is unavailable");
   if(phase==="CREDIT"){
    if(source.journalEntryId)throw new Error("Reverse the matched payout before its credit note");
    await db.update(salesReturns).set({status:"CANCELLED"}).where(eq(salesReturns.id,ret.id));
    await db.update(salesInvoices).set({balanceDue:sql`${salesInvoices.balanceDue}+${amount}`}).where(eq(salesInvoices.id,inv.id));
    await db.update(customers).set({balance:sql`${customers.balance}+${amount}`}).where(and(eq(customers.organizationId,orgId),eq(customers.id,ret.customerId)));
   }else{
    await db.update(salesInvoices).set({balanceDue:sql`${salesInvoices.balanceDue}-${amount}`,refundedAmount:sql`${salesInvoices.refundedAmount}-${amount}`}).where(eq(salesInvoices.id,inv.id));
    await db.update(customers).set({balance:sql`${customers.balance}-${amount}`}).where(and(eq(customers.organizationId,orgId),eq(customers.id,ret.customerId)));
   }
  }
  await db.update(marketplaceSettlementTxns).set(phase==="CREDIT"?{salesReturnId:null}:{journalEntryId:null}).where(eq(marketplaceSettlementTxns.id,source.id));
 }
 await db.update(operations).set({reversedBy:operationId}).where(and(eq(operations.organizationId,orgId),eq(operations.id,target.id)));
 return {state:{...target.beforeState,exception:`Reversed decision: ${reason}`},documents};
}
