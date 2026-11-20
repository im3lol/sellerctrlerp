import "server-only";
import {randomUUID}from "node:crypto";
import {and,eq,inArray,isNull,or,desc,sql}from "drizzle-orm";
import {db,scopeStore}from "@/lib/db";
import {salesInvoices,salesInvoiceLines,salesOrders,deliveryNotes,stockMovements,salesPlatforms,items,
 returnWorkflowCases,returnWorkflowEvents as events,fbaReimbursements,marketplaceSettlementTxns,itemCodes}from "@/db/schema";
import {applyReturnReceipt}from "./inventory";
import {applyReimbursement}from "./reimbursements";
import {scaled,decimal,type ReturnClaim}from "./model";
import {getBaseCurrencyCode,getExchangeRate}from "@/lib/erp/currency";
import {postEntry}from "@/lib/erp/posting";
import {ensurePlatformWalletGl}from "@/lib/erp/platform-provision";
import {ensurePlatformReimbursementAccount}from "@/lib/erp/reimbursements-core";
import {workflowSettings}from "./store";
import {returnProducts}from "./products";

export type SimpleDecision={caseId:string;version:number;key:string;itemId:string;action:"WAITING"|"SELLABLE"|"DAMAGED"|"CLAIM"|"COMPENSATED"|"CLOSED_LOSS";
 quantity:string;warehouseId?:string;invoiceLineId?:string;location:"LOCAL"|"AMAZON";note:string;reference?:string;amount?:string;claimId?:string;confirmed:boolean;activatePosting:boolean};
type Case=typeof returnWorkflowCases.$inferSelect;
type Doc={type:string;id:string};

/** The operator chooses a business outcome. Document IDs and cost are resolved here. */
export async function applySimpleDecision(orgId:string,userId:string,record:Case,d:SimpleDecision,operationId:string){
 let state=structuredClone(record.state);const documents:Doc[]=[];const canonical:Record<string,unknown>={};
 const [item]=await db.select().from(items).where(and(eq(items.organizationId,orgId),eq(items.id,d.itemId))).limit(1);
 if(!item)throw new Error("الصنف غير موجود في هذه المؤسسة");
 const quantity=scaled(d.quantity);if(quantity<=BigInt(0))throw new Error("أدخل الكمية الفعلية للمرتجع");
 const itemAliases=await db.select().from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,item.id)));
 const sourceEvents=await db.select().from(events).where(and(eq(events.organizationId,orgId),eq(events.caseId,record.id))).orderBy(desc(events.createdAt));
 const knownQuantity=returnProducts(state,sourceEvents,[{id:item.id,code:item.code,name:item.nameAr,image:item.image}],itemAliases.map(c=>({itemId:item.id,code:c.normalizedCode}))).find(p=>p.itemId===item.id)?.quantity;
 const date=new Date().toISOString().slice(0,10),evidence=d.note.trim()||`${d.action}: ${item.code}`;
 const boundLines=state.lines.filter(l=>l.itemId===item.id&&(!d.invoiceLineId||l.invoiceLineId===d.invoiceLineId));
 if(boundLines.length>1)throw new Error("اختر الفاتورة الأصلية لهذا المنتج قبل تسجيل المخزون أو الخسارة");
 let line=boundLines[0];
 if(!line){
  const candidates=await db.select({invoice:salesInvoices,line:salesInvoiceLines}).from(salesInvoiceLines)
   .innerJoin(salesInvoices,eq(salesInvoices.id,salesInvoiceLines.salesInvoiceId))
   .leftJoin(deliveryNotes,eq(deliveryNotes.id,salesInvoices.deliveryNoteId))
   .innerJoin(salesOrders,or(eq(salesOrders.id,salesInvoices.salesOrderId),eq(salesOrders.id,deliveryNotes.salesOrderId)))
   .where(and(eq(salesInvoices.organizationId,orgId),eq(salesOrders.organizationId,orgId),eq(salesOrders.channel,"AMAZON"),
    eq(salesOrders.externalOrderId,record.externalOrderId),or(eq(salesOrders.platformId,record.platformId),isNull(salesOrders.platformId)),
    eq(salesInvoiceLines.itemId,item.id),d.invoiceLineId?eq(salesInvoiceLines.id,d.invoiceLineId):undefined,inArray(salesInvoices.status,["POSTED","PARTIAL_PAID","PAID"])));
  const unique=[...new Map(candidates.map(c=>[c.line.id,c])).values()];
  if(unique.length===1){
   const c=unique[0];if(quantity>scaled(c.line.quantity))throw new Error("الكمية أكبر من الكمية المباعة في الفاتورة");
   line={id:c.line.id,itemId:item.id,invoiceId:c.invoice.id,invoiceLineId:c.line.id,deliveryId:c.invoice.deliveryNoteId,soldQuantity:c.line.quantity,
    expectedQuantity:knownQuantity&&scaled(knownQuantity)<=scaled(c.line.quantity)&&scaled(knownQuantity)>=quantity?knownQuantity:d.quantity,receivedQuantity:"0",waivedQuantity:"0",writtenOffQuantity:"0"};
   state.lines.push(line);state.invoiceIds=[...new Set([...state.invoiceIds,c.invoice.id])];state.matched=true;
  }else if(["SELLABLE","DAMAGED","CLOSED_LOSS"].includes(d.action))throw new Error("اختر الفاتورة الأصلية لهذا المنتج قبل تسجيل المخزون أو الخسارة");
 }
 const claim=state.claims.find(c=>d.claimId?c.id===d.claimId:(line?c.lineId===line.id||(!c.lineId&&c.itemId===item.id):c.itemId===item.id)&&!["CLOSED","RECONCILED"].includes(c.state));
 if(d.claimId&&!claim)throw new Error("المطالبة غير موجودة في هذا المرتجع");
 if(claim&&((claim.itemId&&claim.itemId!==item.id)||(claim.lineId&&claim.lineId!==line?.id)))throw new Error("المطالبة غير موجودة في هذا المرتجع");
 if(["SELLABLE","DAMAGED","CLOSED_LOSS"].includes(d.action)){
  if(!d.confirmed||!line)throw new Error("أكد الكمية والقرار قبل التنفيذ");
  if(quantity>scaled(line.soldQuantity))throw new Error("الكمية أكبر من الكمية المباعة في الفاتورة");
  const resolved=scaled(line.receivedQuantity)+scaled(line.waivedQuantity);
  // Closing an already written-off claim never writes the same cost off again.
  const pending=(line.expectedQuantity===null?quantity:scaled(line.expectedQuantity)-resolved);
  const lossAlreadyRecorded=d.action==="CLOSED_LOSS"&&pending===BigInt(0);
  if(!lossAlreadyRecorded){
   if(scaled(line.soldQuantity)<resolved+quantity)throw new Error("القرار يتجاوز الكمية المتبقية من البيع الأصلي");
   if(line.expectedQuantity===null||scaled(line.expectedQuantity)<resolved+quantity)line.expectedQuantity=decimal(resolved+quantity);
   const movements=await db.select().from(stockMovements).where(and(eq(stockMovements.organizationId,orgId),eq(stockMovements.itemId,item.id),eq(stockMovements.type,"OUT"),
    eq(stockMovements.referenceId,line.deliveryId??line.invoiceId),eq(stockMovements.referenceType,line.deliveryId?"DELIVERY":"SALES_INVOICE")));
   if(movements.length!==1)throw new Error("حركة الصرف الأصلية تحتاج مراجعة لتحديد التكلفة الصحيحة");
   const [platform]=await db.select().from(salesPlatforms).where(and(eq(salesPlatforms.organizationId,orgId),eq(salesPlatforms.id,record.platformId))).limit(1);
   const warehouseId=d.warehouseId||platform?.defaultWarehouseId||movements[0].warehouseId;
   if(!warehouseId)throw new Error("اختر مخزن استلام المنتج");
   const proof=await db.select().from(events).where(and(eq(events.organizationId,orgId),eq(events.caseId,record.id),eq(events.kind,"RETURN"))).orderBy(desc(events.createdAt));
   const skuProof=proof.filter(p=>String(p.payload.sku??"").toUpperCase()===item.code.toUpperCase());
   const sourceProof=skuProof[0]??(proof.length===1?proof[0]:undefined);
   if(d.location==="AMAZON")state.fulfillment="FBA";
   const result=await applyReturnReceipt(orgId,userId,record.id,state,{lineId:line.id,quantity:d.quantity,movementId:movements[0].id,warehouseId,
    condition:d.action==="SELLABLE"?"SELLABLE":"WRITE_OFF",notReceived:d.action==="CLOSED_LOSS",location:d.action==="CLOSED_LOSS"?"LOCAL":d.location,
    eventIds:sourceProof?[sourceProof.id]:[],date,evidence});
   Object.assign(canonical,{movementId:movements[0].id,quantity:d.quantity,lineId:line.id,condition:d.action==="SELLABLE"?"SELLABLE":"WRITE_OFF",eventIds:sourceProof?[sourceProof.id]:[]});
   state=result.state;documents.push(...result.documents);
  }
  if(d.action==="CLOSED_LOSS"){
   if(d.note.trim().length<5)throw new Error("اكتب سبب إقفال المرتجع بدون تعويض");
   state.claims=state.claims.map(c=>(c.lineId===line?.id||(!c.lineId&&c.itemId===item.id))&&c.state!=="RECONCILED"?{...c,state:"CLOSED",decisionReason:d.note}:c);
  }
 }
 let pendingCompensation=false;
 if(d.action==="CLAIM"||d.action==="COMPENSATED"){
  const updated:ReturnClaim={...(claim??{}),id:claim?.id??randomUUID(),itemId:item.id,lineId:line?.id??null,reference:d.reference||claim?.reference||null,
   reason:d.note||claim?.reason||"مطالبة تعويض عن المرتجع",state:claim?.state??"REVIEW",expectedAmount:d.amount||claim?.expectedAmount||null,
   acceptedAmount:claim?.acceptedAmount??null,currency:claim?.currency??await getBaseCurrencyCode(orgId),expectedQuantity:claim?.expectedQuantity??"0",evidence};
  if(d.action==="CLAIM"&&updated.reference)updated.state="SUBMITTED";
  state.claims=[...state.claims.filter(c=>c.id!==updated.id),updated];
  if(d.action==="COMPENSATED"){
   if(!d.reference)throw new Error("أدخل رقم تعويض أمازون");
   const sources=await db.select().from(fbaReimbursements).where(and(eq(fbaReimbursements.organizationId,orgId),eq(fbaReimbursements.reimbursementId,d.reference),
    or(eq(fbaReimbursements.orderId,record.externalOrderId),isNull(fbaReimbursements.orderId))));
   const codes=await db.select().from(itemCodes).where(and(eq(itemCodes.organizationId,orgId),eq(itemCodes.itemId,item.id)));
   const normalize=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
   const aliases=[normalize(item.code),...codes.map(c=>c.normalizedCode)];
   const matching=sources.filter(s=>s.sku?aliases.includes(normalize(s.sku)):s.orderId===record.externalOrderId);
   const source=matching.length===1?matching[0]:undefined;
   const proof=source?(await db.select({event:events,platformId:returnWorkflowCases.platformId}).from(events).innerJoin(returnWorkflowCases,eq(returnWorkflowCases.id,events.caseId))
    .where(and(eq(events.organizationId,orgId),eq(returnWorkflowCases.organizationId,orgId),eq(returnWorkflowCases.platformId,record.platformId),eq(events.kind,"REIMBURSEMENT"),eq(events.sourceId,source.id))).orderBy(desc(events.createdAt)).limit(1))[0]:undefined;
   if(source&&proof){
    updated.currency=source.currency??updated.currency;updated.acceptedAmount=source.amountTotal;updated.state="ACCEPTED";
    state.evidenceIds=[...new Set([...(state.evidenceIds??[]),proof.event.id])];
    const wallets=await db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.channel,"AMAZON"),eq(marketplaceSettlementTxns.status,"Released"),
     eq(marketplaceSettlementTxns.currency,updated.currency),eq(marketplaceSettlementTxns.total,source.amountTotal),
     or(eq(marketplaceSettlementTxns.orderId,record.externalOrderId),sql`position(${d.reference} in coalesce(${marketplaceSettlementTxns.description},'')||coalesce(${marketplaceSettlementTxns.sourceIdentifiers}::text,''))>0`)));
    const walletCandidates=wallets.filter(w=>/reimburs|تعويض|safe.?t/i.test(w.type+" "+(w.description??"")));
    if(walletCandidates.length===1){
     const wallet=walletCandidates[0];
     if(!wallet.journalEntryId){
      const config=await workflowSettings(orgId);
      if(!d.confirmed||source.journalEntryId||!config.cutoverAt||!source.approvalDate||source.approvalDate<config.cutoverAt||!wallet.postedAt||wallet.postedAt<config.cutoverAt)throw new Error("مبلغ التعويض يحتاج مراجعة المحاسب قبل إثبات الإيداع");
      const [locked]=await db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.id,wallet.id))).for("update");
      if(!locked.journalEntryId){
       const base=await getBaseCurrencyCode(orgId),rate=await getExchangeRate(orgId,updated.currency,base,new Date());
       if(!(rate>0))throw new Error("سعر تحويل عملة التعويض غير متاح");
       const value=Math.round(Number(source.amountTotal)*rate*100)/100;
       if(!(value>0))throw new Error("مبلغ التعويض غير صالح");
       const cash=await ensurePlatformWalletGl(orgId),income=await ensurePlatformReimbursementAccount(orgId),tx=scopeStore.getStore()!.tx;
       if(!income)throw new Error("مبلغ التعويض يحتاج مراجعة المحاسب قبل إثبات الإيداع");
       const journal=await postEntry(tx,{orgId,date:new Date(),sourceType:"RETURN_REIMBURSEMENT_CASH",sourceId:operationId,userId,description:`Reimbursement ${d.reference}`,lines:[{accountId:cash,debit:value,credit:0},{accountId:income,debit:0,credit:value}]});
       await db.update(marketplaceSettlementTxns).set({journalEntryId:journal}).where(eq(marketplaceSettlementTxns.id,wallet.id));
       documents.push({type:"JOURNAL",id:journal});
       canonical.cashJournalCreated=true;
      }
     }
     const result=await applyReimbursement(orgId,userId,record.id,state,{mode:"CASH_LINK",eventId:proof.event.id,claimId:updated.id,amount:source.amountTotal!,quantity:"0",settlementId:wallet.id,date,evidence});
     state=result.state;documents.push(...result.documents);
     Object.assign(canonical,{mode:"CASH_LINK",sourceId:source.id,claimId:updated.id,settlementId:wallet.id,amount:source.amountTotal,quantity:"0"});
    }else pendingCompensation=true;
   }else pendingCompensation=true;
  }
 }
 const action=pendingCompensation?"CLAIM":d.action;
 state.resolutions=[...(state.resolutions??[]).filter(r=>r.itemId!==item.id),{itemId:item.id,action,quantity:d.quantity,note:d.note,at:new Date().toISOString(),...(d.reference?{reference:d.reference}:{})}];
 return {state,documents:[...new Map(documents.map(doc=>[doc.type+doc.id,doc])).values()],pendingCompensation,canonical};
}
