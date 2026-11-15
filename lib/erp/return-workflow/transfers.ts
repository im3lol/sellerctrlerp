import "server-only";
import { randomUUID } from "node:crypto";
import { and,eq,inArray } from "drizzle-orm";
import {db,scopeStore}from "@/lib/db";
import {returnWorkflowOperations as operations,platformRemovals,salesPlatforms,
 items,itemCodes,warehouses,stockTransfers,stockTransferLines,stockBatches}from "@/db/schema";
import {postStockMovement}from "@/lib/erp/inventory";
import {nextDocumentNumber}from "@/lib/erp/sequence";
import {normalizeCode}from "@/lib/erp/amazon-import";
import {decimal,scaled,type ReturnCaseState}from "./model";
import {workflowSettings}from "./store";
import {caseEvidence}from "./evidence";

export type TransferDecision={phase:"DISPATCH"|"RECEIVE";eventId?:string;transferId?:string;itemId:string;
 fromWarehouseId:string;transitWarehouseId:string;destinationWarehouseId:string;quantity:string;date:string;evidence:string};
export async function applyReturnTransfer(orgId:string,userId:string,caseId:string,platformId:string,state:ReturnCaseState,d:TransferDecision){
 if(d.evidence.trim().length<5||scaled(d.quantity)<=BigInt(0))throw new Error("Positive quantity and transfer evidence are required");
 const date=new Date(d.date+"T12:00:00Z"),config=await workflowSettings(orgId);
 if(!Number.isFinite(date.getTime())||!config.cutoverAt||d.date<config.cutoverAt.toISOString().slice(0,10))throw new Error("Historical transfer dates are observation-only");
 const ids=[d.fromWarehouseId,d.transitWarehouseId,d.destinationWarehouseId];
 if(new Set(ids).size!==3)throw new Error("Origin, transit and destination must be distinct warehouses");
 const wh=await db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.organizationId,orgId),eq(warehouses.isActive,true),inArray(warehouses.id,ids)));
 if(wh.length!==3)throw new Error("Every transfer warehouse must belong to this company");
 const [item]=await db.select().from(items).where(and(eq(items.organizationId,orgId),eq(items.id,d.itemId))).limit(1);
 if(!item)throw new Error("Invalid company item");
 const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
 const quantity=Number(d.quantity);let from=d.fromWarehouseId,to=d.transitWarehouseId,sourceId="",transferId:string=randomUUID();
 const transfers=[...(state.transfers??[])];
 if(d.phase==="DISPATCH"){
  const event=await caseEvidence(orgId,caseId,state,d.eventId??"");
  if(event.kind!=="REMOVAL"||!event.happenedAt||event.happenedAt<config.cutoverAt)throw new Error("A current removal shipment source is required; historical removals remain observation-only");
  const [removal]=await db.select().from(platformRemovals).where(and(eq(platformRemovals.organizationId,orgId),eq(platformRemovals.id,event.sourceId))).for("update");
  const [platform]=await db.select().from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,orgId),eq(salesPlatforms.id,platformId))).limit(1);
  const kind=String((removal?.raw as {orderType?:string}|null)?.orderType??removal?.orderType??"").trim().toLowerCase();
  if(!removal||!platform||platform.defaultWarehouseId!==from||!Number(removal.shippedQty)||kind!=="return")throw new Error("Only a confirmed Return removal can enter the seller's transit warehouse; liquidation requires separate proceeds reconciliation");
  if(removal.stockAdjustmentId)throw new Error("The removal already has a legacy inventory adjustment; reconcile that document first");
  const codes=await db.select({code:itemCodes.normalizedCode}).from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,item.id)));
  if(![normalizeCode(item.code),...codes.map(c=>c.code)].includes(normalizeCode(removal.sku)))throw new Error("The removal SKU does not match this item");
  const prior=await db.select({payload:operations.payload,reversed:operations.reversedBy}).from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.kind,"TRANSFER")));
  const used=prior.filter(o=>!o.reversed&&o.payload.sourceId===removal.id&&o.payload.phase==="DISPATCH").reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  if(used+scaled(d.quantity)>scaled(removal.shippedQty))throw new Error("Shipment quantity is already allocated");
  sourceId=removal.id;
 }else{
  const tr=transfers.find(t=>t.id===d.transferId);
  if(!tr||tr.itemId!==item.id||tr.fromWarehouseId!==from||tr.transitWarehouseId!==d.transitWarehouseId||tr.destinationWarehouseId!==d.destinationWarehouseId)throw new Error("The transit allocation does not match");
  if(scaled(tr.received)+scaled(tr.lost)+scaled(d.quantity)>scaled(tr.dispatched))throw new Error("Receipt exceeds the remaining goods in transit");
  transferId=tr.id;sourceId=tr.sourceId;from=tr.transitWarehouseId;to=tr.destinationWarehouseId;
 }
 const documentId=randomUUID(),number=await nextDocumentNumber(db,orgId,"ST",date.getFullYear());
 await db.insert(stockTransfers).values({id:documentId,organizationId:orgId,number,date,status:"POSTED",fromWarehouseId:from,toWarehouseId:to,
  notes:`Return case ${caseId}; ${d.phase}; ${d.evidence}`});
 await db.insert(stockTransferLines).values({stockTransferId:documentId,itemId:item.id,fromWarehouseId:from,toWarehouseId:to,quantity:d.quantity});
 const [transitBatch]=d.phase==="RECEIVE"?await db.select({id:stockBatches.id}).from(stockBatches)
  .where(and(eq(stockBatches.organizationId,orgId),eq(stockBatches.itemId,item.id),eq(stockBatches.warehouseId,from),eq(stockBatches.batchNo,`return-transfer:${transferId}`))).limit(1):[];
 if(d.phase==="RECEIVE"&&!transitBatch)throw new Error("The original in-transit batch is unavailable");
 const out=await postStockMovement(scope.tx,{orgId,itemId:item.id,warehouseId:from,type:"OUT",quantity,date,referenceType:"STOCK_TRANSFER",referenceId:documentId,
  ...(transitBatch?{allocations:[{batchId:transitBatch.id,quantity}]}:{}),reason:`${d.phase} ${number}`});
 const incoming=await postStockMovement(scope.tx,{orgId,itemId:item.id,warehouseId:to,type:"IN",quantity,unitCost:out.totalCost/quantity,date,
  batchNo:`return-transfer:${transferId}${d.phase==="RECEIVE"?":received":""}`,referenceType:"STOCK_TRANSFER",referenceId:documentId,reason:`${d.phase} ${number}`});
 if(Math.abs(out.totalCost-incoming.totalCost)>0.0001)throw new Error("Transfer value must be conserved");
 if(d.phase==="DISPATCH")transfers.push({id:transferId,itemId:item.id,fromWarehouseId:d.fromWarehouseId,transitWarehouseId:d.transitWarehouseId,
  destinationWarehouseId:d.destinationWarehouseId,dispatched:d.quantity,received:"0",lost:"0",value:String(out.totalCost),sourceId});
 else{const tr=transfers.find(t=>t.id===transferId)!;tr.received=decimal(scaled(tr.received)+scaled(d.quantity));}
 return {state:{...state,matched:true,transfers},documents:[{type:"STOCK_TRANSFER",id:documentId},{type:"STOCK_MOVEMENT",id:out.movementId},{type:"STOCK_MOVEMENT",id:incoming.movementId}],sourceId,transferId};
}
