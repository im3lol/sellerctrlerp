import "server-only";
import {randomUUID}from "node:crypto";
import {and,eq}from "drizzle-orm";
import {db,scopeStore}from "@/lib/db";
import {returnWorkflowOperations as operations,platformRemovals,salesPlatforms,
 items,itemCodes,stockBatches,stockAdjustments,stockAdjustmentLines}from "@/db/schema";
import {postStockMovement}from "@/lib/erp/inventory";
import {postEntry}from "@/lib/erp/posting";
import {resolveAccountIds}from "@/lib/erp/accounting-config";
import {nextDocumentNumber}from "@/lib/erp/sequence";
import {normalizeCode}from "@/lib/erp/amazon-import";
import {scaled,decimal,type ReturnCaseState}from "./model";
import {workflowSettings}from "./store";
import {caseEvidence}from "./evidence";
export type WriteOffDecision={mode:"TRANSIT_LOSS"|"DISPOSAL";eventId?:string;transferId?:string;itemId:string;quantity:string;date:string;evidence:string};
export async function applyReturnWriteOff(orgId:string,userId:string,caseId:string,platformId:string,state:ReturnCaseState,d:WriteOffDecision){
 const config=await workflowSettings(orgId),date=new Date(d.date+"T12:00:00Z");
 if(!config.cutoverAt||d.date<config.cutoverAt.toISOString().slice(0,10)||!Number.isFinite(date.getTime())||scaled(d.quantity)<=BigInt(0)||d.evidence.trim().length<5)throw new Error("Current-date evidence and a positive write-off quantity are required");
 let warehouseId="",sourceId="",batchId:string|undefined;
 const next=structuredClone(state);
 if(d.mode==="TRANSIT_LOSS"){
  const tr=next.transfers?.find(t=>t.id===d.transferId&&t.itemId===d.itemId);
  if(!tr||scaled(tr.received)+scaled(tr.lost)+scaled(d.quantity)>scaled(tr.dispatched))throw new Error("Write-off exceeds the remaining transit quantity");
  warehouseId=tr.transitWarehouseId;sourceId=tr.sourceId;
  const [batch]=await db.select({id:stockBatches.id}).from(stockBatches).where(and(eq(stockBatches.organizationId,orgId),eq(stockBatches.itemId,d.itemId),eq(stockBatches.warehouseId,warehouseId),eq(stockBatches.batchNo,`return-transfer:${tr.id}`))).limit(1);
  if(!batch)throw new Error("Original transit batch not found");batchId=batch.id;
  tr.lost=decimal(scaled(tr.lost)+scaled(d.quantity));
 }else{
  const event=await caseEvidence(orgId,caseId,state,d.eventId??"");
  if(event.kind!=="REMOVAL"||!event.happenedAt||event.happenedAt<config.cutoverAt)throw new Error("A current disposal source is required; historical disposals remain observation-only");
  const [removal]=await db.select().from(platformRemovals).where(and(eq(platformRemovals.organizationId,orgId),eq(platformRemovals.id,event.sourceId))).for("update");
  const [platform]=await db.select().from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,orgId),eq(salesPlatforms.id,platformId))).limit(1);
  const [item]=await db.select().from(items).where(and(eq(items.organizationId,orgId),eq(items.id,d.itemId))).limit(1);
  const kind=String((removal?.raw as {orderType?:string}|null)?.orderType??removal?.orderType??"").trim().toLowerCase();
  if(!removal||kind!=="disposal"||!platform?.defaultWarehouseId||!item||removal.stockAdjustmentId)throw new Error("A confirmed Disposal source is required; liquidation is not a disposal or automatic reimbursement");
  const codes=await db.select({code:itemCodes.normalizedCode}).from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,item.id)));
  if(![normalizeCode(item.code),...codes.map(c=>c.code)].includes(normalizeCode(removal.sku)))throw new Error("Disposal item does not match source SKU");
  const prior=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.kind,"WRITE_OFF")));
  const used=prior.filter(o=>!o.reversedBy&&o.payload.sourceId===removal.id&&o.payload.mode==="DISPOSAL").reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  if(used+scaled(d.quantity)>scaled(removal.disposedQty))throw new Error("Disposal source quantity is already allocated");
  warehouseId=platform.defaultWarehouseId;sourceId=removal.id;
  next.disposals=[...(next.disposals??[]).filter(r=>r.sourceId!==sourceId),{sourceId,quantity:decimal(used+scaled(d.quantity)),expectedQuantity:removal.disposedQty}];
 }
 const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
 const id=randomUUID(),number=await nextDocumentNumber(db,orgId,"SA",date.getFullYear()),quantity=Number(d.quantity);
 const movement=await postStockMovement(scope.tx,{orgId,itemId:d.itemId,warehouseId,type:"OUT",quantity,date,
  ...(batchId?{allocations:[{batchId,quantity}]}:{}),referenceType:"STOCK_ADJUSTMENT",referenceId:id,reason:d.evidence});
 const value=Math.round(movement.totalCost*100)/100;
 await db.insert(stockAdjustments).values({id,organizationId:orgId,number,date,itemId:d.itemId,warehouseId,mode:"delta",enteredValue:String(-quantity),
  deltaQuantity:String(-quantity),totalValue:String(value),status:"POSTED",reason:`Return case ${caseId}: ${d.evidence}`,movementId:movement.movementId});
 await db.insert(stockAdjustmentLines).values({stockAdjustmentId:id,itemId:d.itemId,warehouseId,mode:"delta",enteredValue:String(-quantity),deltaQuantity:String(-quantity),unitCost:String(movement.totalCost/quantity),totalValue:String(value),movementId:movement.movementId,notes:d.evidence});
 const documents:{type:string;id:string}[]=[{type:"STOCK_ADJUSTMENT",id},{type:"STOCK_MOVEMENT",id:movement.movementId}];
 if(value){const A=await resolveAccountIds(orgId,["1104","5301"]);if(!A["1104"]||!A["5301"])throw new Error("Missing loss/inventory accounts");
  const jv=await postEntry(scope.tx,{orgId,date,sourceType:"RETURN_WRITE_OFF",sourceId:id,description:`Approved return loss ${number}`,userId,
   lines:[{accountId:A["5301"],debit:value,credit:0},{accountId:A["1104"],debit:0,credit:value}]});documents.push({type:"JOURNAL",id:jv});}
 return {state:{...next,matched:true},documents,sourceId};
}
