import "server-only";
import {randomUUID}from "node:crypto";
import {and,eq}from "drizzle-orm";
import {db,scopeStore}from "@/lib/db";
import {returnWorkflowOperations as operations,returnWorkflowEvents as events,fbaReimbursements,marketplaceSettlementTxns,
 journalEntries,stockMovements,warehouses,items,itemCodes}from "@/db/schema";
import {scaled,decimal,type ReturnCaseState}from "./model";
import {postStockMovement}from "@/lib/erp/inventory";
import {postEntry}from "@/lib/erp/posting";
import {resolveAccountIds}from "@/lib/erp/accounting-config";
import {ensurePlatformReimbursementAccount}from "@/lib/erp/reimbursements-core";
import {normalizeCode}from "@/lib/erp/amazon-import";
import {workflowSettings}from "./store";
import {caseEvidence}from "./evidence";
import {originalReceiptCost}from "./original-cost";

export type ReimbursementDecision={mode:"CASH_LINK"|"INVENTORY";eventId:string;claimId:string;amount:string;quantity:string;
 settlementId?:string;warehouseId?:string;itemId?:string;originalMovementId?:string;inventoryEvidenceId?:string;date:string;evidence:string};
export async function applyReimbursement(orgId:string,userId:string,caseId:string,state:ReturnCaseState,d:ReimbursementDecision){
 const claim=state.claims.find(c=>c.id===d.claimId);if(!claim||["CLOSED","RECONCILED"].includes(claim.state))throw new Error("An open claim allocation is required");
 if(d.evidence.trim().length<5)throw new Error("Reimbursement evidence is required");
 const event=await caseEvidence(orgId,caseId,state,d.eventId);
 if(!event||event.kind!=="REIMBURSEMENT")throw new Error("An Amazon reimbursement source is required");
 const [source]=await db.select().from(fbaReimbursements).where(and(eq(fbaReimbursements.organizationId,orgId),eq(fbaReimbursements.id,event.sourceId))).for("update");
 if(!source||!source.currency||source.currency!==claim.currency)throw new Error("Claim/source currency mismatch");
 const previous=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.kind,"REIMBURSEMENT")));
 const active=previous.filter(o=>!o.reversedBy);
 const same=active.filter(o=>o.payload.sourceId===source.id);
 const documents:{type:string;id:string}[]=[];
 if(d.mode==="CASH_LINK"){
  if(scaled(d.amount)<=BigInt(0))throw new Error("A positive matched cash amount is required");
  const [settlement]=await db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.id,d.settlementId??""))).for("update");
  if(!settlement||!settlement.journalEntryId||!/reimburs|تعويض|safe.?t/i.test(settlement.type+" "+(settlement.description??""))||settlement.currency!==source.currency)throw new Error("A posted reimbursement wallet movement is required");
  const [jv]=await db.select().from(journalEntries).where(and(eq(journalEntries.organizationId,orgId),eq(journalEntries.id,settlement.journalEntryId),eq(journalEntries.status,"POSTED"))).limit(1);
  if(!jv||jv.reversedById)throw new Error("The wallet journal is not posted or has been reversed");
  const usedSource=same.filter(o=>o.payload.mode==="CASH_LINK").reduce((s,o)=>s+scaled(String(o.payload.amount)),BigInt(0));
  const usedWallet=active.filter(o=>o.payload.mode==="CASH_LINK"&&o.payload.settlementId===settlement.id).reduce((s,o)=>s+scaled(String(o.payload.amount)),BigInt(0));
  if(usedSource+scaled(d.amount)>scaled(source.amountTotal)||usedWallet+scaled(d.amount)>scaled(settlement.total))throw new Error("The source or wallet amount is already allocated");
  documents.push({type:"JOURNAL",id:jv.id},{type:"SETTLEMENT_SOURCE",id:settlement.id});
 }else{
  if(scaled(d.quantity)<=BigInt(0))throw new Error("A positive inventory reimbursement quantity is required");
  const config=await workflowSettings(orgId);
  if(!config.cutoverAt||!event.happenedAt||event.happenedAt<config.cutoverAt)throw new Error("Historical inventory reimbursements are observation-only");
  const used=same.filter(o=>o.payload.mode==="INVENTORY").reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  if(used+scaled(d.quantity)>scaled(source.quantityReimbursedInventory))throw new Error("Inventory reimbursement quantity is already allocated");
  if(source.journalEntryId)throw new Error("This reimbursement already has a legacy accounting document; reconcile it first");
  const [original]=await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,orgId),eq(stockMovements.id,d.originalMovementId??""))).for("update");
  const [warehouse]=await db.select().from(warehouses).where(and(eq(warehouses.organizationId,orgId),eq(warehouses.id,d.warehouseId??""),eq(warehouses.isActive,true))).limit(1);
  const [item]=await db.select().from(items).where(and(eq(items.organizationId,orgId),eq(items.id,d.itemId??""))).limit(1);
  if(!original||original.type!=="OUT"||!item||original.itemId!==item.id||!warehouse)throw new Error("Original loss cost and destination are required");
  const saleOrigin=claim.lineId&&state.lines.some(l=>l.id===claim.lineId&&l.itemId===item.id&&(l.deliveryId?original.referenceType==="DELIVERY"&&original.referenceId===l.deliveryId:original.referenceType==="SALES_INVOICE"&&original.referenceId===l.invoiceId));
  if(!saleOrigin&&!state.lossMovementIds?.includes(original.id))throw new Error("Match the claim's original sale or posted stock loss before reimbursement");
  const originalUsed=active.filter(o=>o.payload.mode==="INVENTORY"&&o.payload.originalMovementId===original.id).reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  if(originalUsed+scaled(d.quantity)>scaled(original.quantity))throw new Error("The original loss quantity is already reimbursed");
  const proof=await caseEvidence(orgId,caseId,state,d.inventoryEvidenceId??"");
  if(!proof||proof.kind!=="LEDGER"||proof.quantity===null||scaled(proof.quantity)<scaled(d.quantity))throw new Error("An inventory receipt proof is required");
  if(!/adjustment|receipt/i.test(String(proof.payload.eventType??"")))throw new Error("A customer return cannot also serve as inventory reimbursement evidence");
  const revisions=await db.select({id:events.id}).from(events).where(and(eq(events.organizationId,orgId),eq(events.kind,"LEDGER"),eq(events.sourceId,proof.sourceId)));
  const proofIds=new Set(revisions.map(e=>e.id));
  const proofOperations=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.kind,"REIMBURSEMENT")));
  const usedProof=proofOperations.filter(o=>!o.reversedBy&&proofIds.has(String(o.payload.inventoryEvidenceId))).reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  if(usedProof+scaled(d.quantity)>scaled(proof.quantity))throw new Error("Inventory proof already allocated");
  const codes=await db.select({code:itemCodes.normalizedCode}).from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,item.id)));
  if(![normalizeCode(item.code),...codes.map(c=>c.code)].includes(normalizeCode(source.sku??"")))throw new Error("Reimbursement SKU mismatch");
  if(![normalizeCode(item.code),...codes.map(c=>c.code)].includes(normalizeCode(String(proof.payload.sku??""))))throw new Error("Inventory reimbursement proof SKU mismatch");
  const date=new Date(d.date+"T12:00:00Z");if(!Number.isFinite(date.getTime())||d.date<config.cutoverAt.toISOString().slice(0,10))throw new Error("Invalid reimbursement date");
  const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
  const {unitCost:cost}=originalReceiptCost(original.totalCost,original.quantity,d.quantity),quantity=Number(d.quantity),id=randomUUID();
  const accounts=await resolveAccountIds(orgId,["1104"]),income=await ensurePlatformReimbursementAccount(orgId);
  if(!accounts["1104"]||!income)throw new Error("Missing reimbursement accounts");
  const move=await postStockMovement(scope.tx,{orgId,itemId:item.id,warehouseId:warehouse.id,type:"IN",quantity,unitCost:cost,date,
   referenceType:"RETURN_REIMBURSEMENT",referenceId:id,batchNo:`reimbursement:${source.id}`,reason:d.evidence});
  const value=Math.round(move.totalCost*100)/100;
  const jv=value?await postEntry(scope.tx,{orgId,date,sourceType:"RETURN_INVENTORY_REIMBURSEMENT",sourceId:id,description:`Inventory reimbursement ${source.reimbursementId}`,userId,
   lines:[{accountId:accounts["1104"],debit:value,credit:0},{accountId:income,debit:0,credit:value}]}):null;
  documents.push({type:"STOCK_MOVEMENT",id:move.movementId});if(jv)documents.push({type:"JOURNAL",id:jv});
 }
 const own=active.filter(o=>o.caseId===caseId&&o.payload.claimId===claim.id);
 const cash=own.filter(o=>o.payload.mode==="CASH_LINK").reduce((s,o)=>s+scaled(String(o.payload.amount)),BigInt(0))+(d.mode==="CASH_LINK"?scaled(d.amount):BigInt(0));
 const units=own.filter(o=>o.payload.mode==="INVENTORY").reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0))+(d.mode==="INVENTORY"?scaled(d.quantity):BigInt(0));
 const requiredCash=claim.acceptedAmount??claim.expectedAmount;
 const cashDone=requiredCash!==null?cash>=scaled(requiredCash):d.mode!=="CASH_LINK";
 const unitsDone=claim.expectedQuantity?units>=scaled(claim.expectedQuantity):d.mode!=="INVENTORY";
 const updated={...claim,reconciledCash:decimal(cash),reconciledQuantity:decimal(units),state:cashDone&&unitsDone?"RECONCILED"as const:"ACCEPTED"as const};
 return {state:{...state,claims:state.claims.map(c=>c.id===claim.id?updated:c)},documents,sourceId:source.id};
}
