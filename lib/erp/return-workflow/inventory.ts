import "server-only";
import { randomUUID } from "node:crypto";
import { and,desc, eq,inArray,or, sql } from "drizzle-orm";
import { db, scopeStore } from "@/lib/db";
import { stockMovements, stockMovementBatches,items,itemCodes,salesPlatforms,returnWorkflowCases, salesReturns, salesReturnLines, salesInvoices, deliveryNotes, warehouses,
  returnWorkflowOperations as operations, returnWorkflowEvents as events } from "@/db/schema";
import { postStockMovement } from "@/lib/erp/inventory";
import { postEntry } from "@/lib/erp/posting";
import { resolveAccountIds } from "@/lib/erp/accounting-config";
import { nextDocumentNumber } from "@/lib/erp/sequence";
import { assertReceiptCapacity, decimal, scaled, type ReturnCaseState } from "./model";
import { workflowSettings } from "./store";
import {caseEvidence}from "./evidence";
import {normalizeCode}from "@/lib/erp/amazon-import";
import {physicalReceiptCapacity}from "./physical-proof";
import {originalReceiptCost}from "./original-cost";

export type ReceiptDecision={lineId:string;quantity:string;movementId:string;warehouseId:string;
 condition:"SELLABLE"|"QUARANTINE"|"WRITE_OFF";location:"AMAZON"|"LOCAL";
 eventIds:string[];evidence:string;date:string};

export async function applyReturnReceipt(orgId:string,userId:string,caseId:string,state:ReturnCaseState,d:ReceiptDecision){
  const line=state.lines.find(l=>l.id===d.lineId);
  if(!state.matched||!line)throw new Error("Match the original sales line first");
  assertReceiptCapacity(line,d.quantity);
  if(d.evidence.trim().length<5)throw new Error("Receipt evidence is required");
  const [movement]=await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,orgId),eq(stockMovements.id,d.movementId))).for("update");
  if(!movement||movement.type!=="OUT"||movement.itemId!==line.itemId||
    !(line.deliveryId?movement.referenceType==="DELIVERY"&&movement.referenceId===line.deliveryId:
      movement.referenceType==="SALES_INVOICE"&&movement.referenceId===line.invoiceId))throw new Error("The stock issue does not belong to the original sale");
  if(d.location==="AMAZON")for(const id of [...new Set(d.eventIds)].sort())await caseEvidence(orgId,caseId,state,id);
  const prior=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.kind,"RECEIPT")));
  const used=prior.filter(o=>!o.reversedBy&&o.payload.movementId===movement.id)
    .reduce((s,o)=>s+scaled(String(o.payload.quantity)),BigInt(0));
  const [legacy]=await db.execute<{quantity:string}>(sql`select coalesce(sum(l.quantity),0)::text quantity from sales_return_lines l
    join sales_returns r on r.id=l.sales_return_id and r.organization_id=${orgId} and r.status='POSTED'
    where l.item_id=${line.itemId} and ${line.deliveryId?sql`r.delivery_note_id=${line.deliveryId}`:sql`r.sales_invoice_id=${line.invoiceId} and r.delivery_note_id is null`}
    and not exists(select 1 from return_workflow_operations o where o.organization_id=${orgId} and o.documents @> jsonb_build_array(jsonb_build_object('id',r.id)))`).then(r=>r.rows);
  if(used+scaled(legacy?.quantity??"0")+scaled(d.quantity)>scaled(movement.quantity))throw new Error("The original issue quantity has already been returned");
  const [warehouse]=await db.select().from(warehouses).where(and(eq(warehouses.organizationId,orgId),eq(warehouses.id,d.warehouseId),eq(warehouses.isActive,true))).limit(1);
  if(!warehouse)throw new Error("Invalid company warehouse");
  const [originalItem]=await db.select({tracking:items.tracking}).from(items).where(and(eq(items.organizationId,orgId),eq(items.id,line.itemId))).limit(1);
  if(originalItem?.tracking==="SERIAL")throw new Error("Serial-tracked returns require a serial allocation review before posting");
  const lots=await db.select().from(stockMovementBatches).where(and(eq(stockMovementBatches.organizationId,orgId),eq(stockMovementBatches.movementId,movement.id)));
  if(lots.length>1&&scaled(d.quantity)!==scaled(movement.quantity))throw new Error("A partial return from several original lots requires a separate lot-cost allocation review");
  if(lots.length>1&&new Set(lots.map(l=>l.expiryDate?.toISOString()??"")).size>1)throw new Error("Separate the original expiry lots before returning them");
  if(d.condition==="SELLABLE"&&lots.some(l=>l.expiryDate&&l.expiryDate.toISOString().slice(0,10)<=d.date))throw new Error("Expired returns require quarantine or approved disposal");
  if(d.condition==="QUARANTINE"&&(!warehouse.isQuarantine||d.warehouseId===movement.warehouseId))throw new Error("Unsellable goods require a separate designated quarantine warehouse");
  if(d.location==="AMAZON"){
    if(state.fulfillment!=="FBA"||!d.eventIds.length)throw new Error("An Amazon receipt requires FBA source evidence");
    const config=await workflowSettings(orgId);
    const [item]=await db.select().from(items).where(and(eq(items.organizationId,orgId),eq(items.id,line.itemId))).limit(1);
    const codes=await db.select().from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,line.itemId)));
    const aliases=[normalizeCode(item?.code??""),...codes.map(c=>c.normalizedCode)];
    const [owner]=await db.select().from(returnWorkflowCases).where(and(eq(returnWorkflowCases.organizationId,orgId),eq(returnWorkflowCases.id,caseId))).limit(1);
    const [platform]=await db.select().from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,orgId),eq(salesPlatforms.id,owner.platformId))).limit(1);
    if(d.condition==="SELLABLE"&&d.warehouseId!==platform?.defaultWarehouseId)throw new Error("Amazon receipt must use this account's FBA warehouse");
    for(const id of d.eventIds){
      const e=await caseEvidence(orgId,caseId,state,id);
      if(!e||!["RETURN","LEDGER"].includes(e.kind)||!e.happenedAt||!config.cutoverAt||e.happenedAt<config.cutoverAt)throw new Error("Historical or invalid receipt evidence is observation-only");
      if(e.kind==="RETURN"&&e.payload.fulfillment!=="FBA")throw new Error("A seller-fulfilled return does not prove receipt at Amazon");
      if(d.condition==="SELLABLE"&&String(e.payload.disposition??"").toUpperCase()!=="SELLABLE")throw new Error("Amazon source does not confirm sellable condition; quarantine the goods for review");
      const sku=String(e.payload.sku??e.payload.msku??"");
      if(!sku||!aliases.includes(normalizeCode(sku)))throw new Error("Receipt evidence SKU does not match the original item");
      if(e.kind==="LEDGER"&&e.payload.eventType!=="CustomerReturns")throw new Error("Only a customer-return ledger event proves this return receipt");
      if(e.kind==="LEDGER"&&e.payload.referenceId&&e.payload.referenceId!==owner.externalOrderId)throw new Error("The return ledger reference does not match the original order");
      const revisions=await db.select({id:events.id}).from(events).where(and(eq(events.organizationId,orgId),eq(events.kind,e.kind),eq(events.sourceId,e.sourceId)));
      const ids=new Set(revisions.map(r=>r.id));
      const allocated=prior.filter(o=>!o.reversedBy&&(o.payload.eventIds as string[]|undefined)?.some(id=>ids.has(id))).reduce((sum,o)=>sum+scaled(String(o.payload.quantity)),BigInt(0));
      if(e.quantity===null||allocated+scaled(d.quantity)>scaled(e.quantity))throw new Error("Receipt quantity exceeds the remaining source evidence");
    }
    const allProof=await db.select().from(events).where(and(eq(events.organizationId,orgId),or(eq(events.caseId,caseId),state.evidenceIds?.length?inArray(events.id,state.evidenceIds):eq(events.caseId,caseId)))).orderBy(desc(events.createdAt));
    const relevant=allProof.filter(e=>e.happenedAt&&config.cutoverAt&&e.happenedAt>=config.cutoverAt&&aliases.includes(normalizeCode(String(e.payload.sku??""))));
    const received=state.lines.filter(l=>l.itemId===line.itemId).reduce((s,l)=>s+scaled(l.receivedQuantity),BigInt(0));
    if(received+scaled(d.quantity)>physicalReceiptCapacity(relevant))throw new Error("Return report and ledger describe the same goods; receipt evidence cannot be counted twice");
  }
  const date=new Date(d.date+"T12:00:00Z");if(!Number.isFinite(date.getTime()))throw new Error("Invalid receipt date");
  const config=await workflowSettings(orgId);
  if(!config.cutoverAt||d.date<config.cutoverAt.toISOString().slice(0,10))throw new Error("Historical receipts require a separately approved reconciliation");
  const {unitCost:cost,value}=originalReceiptCost(movement.totalCost,movement.quantity,d.quantity),quantity=Number(d.quantity);
  const A=await resolveAccountIds(orgId,["1104","5101","5301"]);
  if(!A["1104"]||!A["5101"]||(d.condition==="WRITE_OFF"&&!A["5301"]))throw new Error("Missing inventory/return accounts");
  const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
  const id=randomUUID(),number=await nextDocumentNumber(db,orgId,"SR",date.getFullYear());
  const [invoice]=await db.select({customerId:salesInvoices.customerId,orderId:salesInvoices.salesOrderId,status:salesInvoices.status}).from(salesInvoices)
    .where(and(eq(salesInvoices.organizationId,orgId),eq(salesInvoices.id,line.invoiceId))).limit(1);
  if(!invoice||!["POSTED","PARTIAL_PAID","PAID"].includes(invoice.status))throw new Error("Original invoice is no longer posted");
  const [dn]=line.deliveryId?await db.select({orderId:deliveryNotes.salesOrderId,status:deliveryNotes.status}).from(deliveryNotes)
    .where(and(eq(deliveryNotes.organizationId,orgId),eq(deliveryNotes.id,line.deliveryId))).limit(1):[];
  if(line.deliveryId&&!["DELIVERED","INVOICED"].includes(dn?.status??""))throw new Error("Original delivery is no longer posted");
  await db.insert(salesReturns).values({id,organizationId:orgId,number,date,status:"POSTED",customerId:invoice.customerId,
    warehouseId:d.warehouseId,deliveryNoteId:line.deliveryId,salesOrderId:dn?.orderId??invoice.orderId,
    totalAmount:String(value),disposition:d.condition==="SELLABLE"?"SELLABLE":"UNSELLABLE",channel:"AMAZON",
    notes:`Return workflow stock ${caseId}; original issue ${movement.id}; ${d.evidence}`});
  await db.insert(salesReturnLines).values({salesReturnId:id,itemId:line.itemId,quantity:d.quantity,unitPrice:String(cost),totalAmount:String(value)});
  const documents:{type:string;id:string}[]=[{type:"STOCK_RETURN",id}];
  if(d.condition!=="WRITE_OFF"){
    const r=await postStockMovement(scope.tx,{orgId,itemId:line.itemId,warehouseId:d.warehouseId,type:"IN",quantity,unitCost:cost,date,
      batchNo:`return-receipt:${id}`,expiryDate:lots[0]?.expiryDate??null,referenceType:"SALES_RETURN",referenceId:id,reason:`Return receipt ${number}`});
    documents.push({type:"STOCK_MOVEMENT",id:r.movementId});
  }
  if(value){const jv=await postEntry(scope.tx,{orgId,date,sourceType:"SALES_RETURN",sourceId:id,description:`Stock receipt ${number}`,userId,
    lines:[{accountId:d.condition==="WRITE_OFF"?A["5301"]:A["1104"],debit:value,credit:0},{accountId:A["5101"],debit:0,credit:value}]});documents.push({type:"JOURNAL",id:jv});}
  return {state:{...state,lines:state.lines.map(l=>l.id===line.id?{...l,receivedQuantity:decimal(scaled(l.receivedQuantity)+scaled(d.quantity)),
    writtenOffQuantity:d.condition==="WRITE_OFF"?decimal(scaled(l.writtenOffQuantity)+scaled(d.quantity)):l.writtenOffQuantity}:l)},documents};
}
