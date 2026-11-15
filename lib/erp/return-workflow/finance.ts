import "server-only";
import {randomUUID} from "node:crypto";
import {and,eq,sql} from "drizzle-orm";
import {db,scopeStore} from "@/lib/db";
import {salesInvoices,salesInvoiceLines,salesReturns,salesReturnLines,customers,marketplaceSettlementTxns,
 deliveryNotes,warehouses,returnWorkflowEvents as events,returnWorkflowOperations as operations} from "@/db/schema";
import {postEntry} from "@/lib/erp/posting";
import {resolveAccountIds} from "@/lib/erp/accounting-config";
import {nextDocumentNumber} from "@/lib/erp/sequence";
import {ensurePlatformWalletGl} from "@/lib/erp/platform-provision";
import {getBaseCurrencyCode,getExchangeRate} from "@/lib/erp/currency";
import {ensureFxAccounts} from "@/lib/erp/fx-revaluation";
import {refundReconciliation,allocationFingerprint} from "./finance-math";
import {refundAmount,scaled,decimal,type MoneyParts,type ReturnCaseState} from "./model";
import {workflowSettings} from "./store";

export type FinanceAllocation={invoiceId:string;lineId:string;parts:MoneyParts;quantity:string|null};
export type FinanceDecision={phase:"CREDIT"|"SETTLEMENT";eventId:string;invoiceId?:string;lineId?:string;
 parts:MoneyParts;quantity?:string|null;allocations?:FinanceAllocation[];date:string;evidence:string;verified:boolean};
const round=(n:number)=>Math.round(n*100)/100;
type Doc={type:string;id:string};

/** Credit and payout are independent, atomic approvals. A single source can be
 * allocated across multiple invoice lines; fees are posted once, at source level. */
export async function applyReturnFinance(orgId:string,userId:string,caseId:string,state:ReturnCaseState,d:FinanceDecision,operationId:string){
 if(!d.verified||d.evidence.trim().length<5)throw new Error("Verify the source components and evidence first");
 const allocations=d.allocations??(d.invoiceId&&d.lineId?[{invoiceId:d.invoiceId,lineId:d.lineId,parts:d.parts,quantity:d.quantity??null}]:[]);
 if(!state.matched||!allocations.length||new Set(allocations.map(a=>a.lineId)).size!==allocations.length)throw new Error("Unique original line allocations are required");
 for(const key of ["principal","discount","tax","shipping"]as const){
  if(allocations.reduce((sum,a)=>sum+scaled(a.parts[key]),BigInt(0))!==scaled(d.parts[key]))throw new Error("Line allocations do not equal the source components");
 }
 const [event]=await db.select().from(events).where(and(eq(events.organizationId,orgId),eq(events.caseId,caseId),eq(events.id,d.eventId))).limit(1);
 if(!event||event.kind!=="REFUND")throw new Error("A financial refund source is required");
 const config=await workflowSettings(orgId);
 if(!config.cutoverAt||!event.happenedAt||event.happenedAt<config.cutoverAt)throw new Error("Historical financial evidence is observation-only");
 const [source]=await db.select().from(marketplaceSettlementTxns).where(and(eq(marketplaceSettlementTxns.organizationId,orgId),eq(marketplaceSettlementTxns.id,event.sourceId))).for("update");
 if(!source||source.type!=="Refund"||source.channel!=="AMAZON"||!source.currency)throw new Error("Unsupported or missing financial source/currency");
 const fees=[source.sellingFees,source.fbaFees,source.otherTransactionFees];
 refundReconciliation(d.parts,source.total,fees);
 const date=new Date(d.date+"T12:00:00Z");if(!Number.isFinite(date.getTime()))throw new Error("Invalid posting date");
 if(d.date<config.cutoverAt.toISOString().slice(0,10))throw new Error("Historical posting dates are observation-only");
 const base=await getBaseCurrencyCode(orgId),rate=await getExchangeRate(orgId,source.currency,base,date);
 if(!(rate>0))throw new Error("Missing currency exchange rate");
 const A=await resolveAccountIds(orgId,["4102","2102","1103","5203","5211","5212","5213"]);
 if(!A["4102"]||!A["1103"])throw new Error("Missing return/receivable accounts");
 const scope=scopeStore.getStore();if(!scope)throw new Error("Tenant scope required");
 const prior=await db.select().from(operations).where(and(eq(operations.organizationId,orgId),eq(operations.caseId,caseId),eq(operations.kind,"FINANCIAL")));
 const same=prior.filter(o=>o.payload.sourceId===source.id&&!o.reversedBy);
 if(same.some(o=>o.payload.phase===d.phase))throw new Error("This financial source phase has already been approved");
 const documents:Doc[]=[];
 if(d.phase==="CREDIT"){
  if(source.salesReturnId||source.journalEntryId)throw new Error("This source has a legacy document; reconcile it without creating another credit");
  const invoiceIds=[...new Set(allocations.map(a=>a.invoiceId))].sort();
  for(const invoiceId of invoiceIds){
   const [inv]=await db.select().from(salesInvoices).where(and(eq(salesInvoices.organizationId,orgId),eq(salesInvoices.id,invoiceId))).for("update");
   if(!inv||!["POSTED","PARTIAL_PAID","PAID"].includes(inv.status))throw new Error("The original invoice is not posted");
   const creditRate=source.currency===inv.currencyCode?Number(inv.exchangeRate):source.currency===base?1:0;
   if(!(creditRate>0))throw new Error("The refund currency does not match the invoice");
   const money=(s:string)=>round(Number(s)*creditRate);
   const selected=allocations.filter(a=>a.invoiceId===inv.id);
   const components={principal:BigInt(0),discount:BigInt(0),tax:BigInt(0),shipping:BigInt(0)};
   const lineValues:{itemId:string;quantity:string;unitPrice:string;totalAmount:string}[]=[];
   for(const allocation of selected){
    const bound=state.lines.find(l=>l.id===allocation.lineId&&l.invoiceId===invoiceId);
    if(!bound)throw new Error("Allocation is not matched to this case");
    const [original]=await db.select().from(salesInvoiceLines).where(and(eq(salesInvoiceLines.organizationId,orgId),eq(salesInvoiceLines.id,bound.invoiceLineId),eq(salesInvoiceLines.salesInvoiceId,inv.id))).limit(1);
    if(!original)throw new Error("Original line is unavailable");
    if(allocation.quantity!==null){
     const [returned]=(await db.execute<{q:string}>(sql`select coalesce(sum(l.quantity),0)::text q from sales_return_lines l join sales_returns r on r.id=l.sales_return_id where r.organization_id=${orgId} and r.sales_invoice_id=${inv.id} and r.status='POSTED' and r.delivery_note_id is null and l.item_id=${original.itemId}`)).rows;
     if(scaled(allocation.quantity)<=BigInt(0)||scaled(allocation.quantity)+scaled(returned?.q??"0")>scaled(original.quantity))throw new Error("Returned quantity exceeds the original invoice line");
    }
    const product=money(decimal(scaled(allocation.parts.principal)-scaled(allocation.parts.discount)));
    if(product<0)throw new Error("The line discount exceeds its principal");
    lineValues.push({itemId:original.itemId,quantity:allocation.quantity??"0",unitPrice:allocation.quantity?String(product/Number(allocation.quantity)):"0",totalAmount:String(product)});
    for(const key of ["principal","discount","tax","shipping"]as const)components[key]+=scaled(allocation.parts[key]);
   }
   const parts={principal:decimal(components.principal),discount:decimal(components.discount),tax:decimal(components.tax),shipping:decimal(components.shipping)};
   const total=money(refundAmount(parts)),subtotal=money(parts.principal),discount=money(parts.discount),tax=money(parts.tax),shipping=money(parts.shipping);
   if(Math.abs(subtotal-discount+tax+shipping-total)>0.005)throw new Error("Converted components require a rounding-allocation review");
   const priorCredits=await db.select({amount:salesReturns.totalAmount,components:salesReturns.financialComponents}).from(salesReturns)
    .where(and(eq(salesReturns.organizationId,orgId),eq(salesReturns.salesInvoiceId,inv.id),eq(salesReturns.status,"POSTED")));
   if(total+priorCredits.reduce((s,r)=>s+Number(r.amount),0)>Number(inv.totalAmount)+0.005)throw new Error("Refund exceeds the remaining invoice value");
   if(priorCredits.some(r=>!r.components))throw new Error("Prior legacy credits need a component reconciliation before another financial approval");
   for(const [key,value,original]of [["subtotal",subtotal,inv.subtotal],["discount",discount,inv.discountAmount],["tax",tax,inv.taxAmount],["shipping",shipping,inv.shippingAmount]]as const){
    const used=priorCredits.reduce((s,r)=>s+Number(r.components?.[key]??0),0);
    if(value+used>Number(original)+0.005)throw new Error(`Refund ${key} exceeds the original invoice component`);
   }
   const [dn]=inv.deliveryNoteId?await db.select({wh:deliveryNotes.warehouseId,orderId:deliveryNotes.salesOrderId}).from(deliveryNotes)
    .where(and(eq(deliveryNotes.organizationId,orgId),eq(deliveryNotes.id,inv.deliveryNoteId))).limit(1):[];
   const [warehouse]=await db.select({id:warehouses.id}).from(warehouses).where(and(eq(warehouses.organizationId,orgId),dn?.wh?eq(warehouses.id,dn.wh):eq(warehouses.isActive,true))).limit(1);
   if(!warehouse)throw new Error("A company warehouse is required for the document");
   const id=randomUUID(),number=await nextDocumentNumber(db,orgId,"SR",date.getFullYear());
   await db.insert(salesReturns).values({id,organizationId:orgId,number,date,status:"POSTED",customerId:inv.customerId,warehouseId:warehouse.id,
    salesInvoiceId:inv.id,salesOrderId:inv.salesOrderId??dn?.orderId,totalAmount:String(total),financialComponents:{subtotal:String(subtotal),discount:String(discount),tax:String(tax),shipping:String(shipping)},
    channel:"AMAZON",externalReturnId:source.orderId,notes:`Return workflow ${caseId}; source ${source.id}`});
   await db.insert(salesReturnLines).values(lineValues.map(l=>({...l,salesReturnId:id})));
   const legs=[{accountId:A["4102"],debit:total-tax,credit:0},{accountId:A["1103"],debit:0,credit:total}];
   if(tax){if(!A["2102"])throw new Error("Missing output tax account");legs.push({accountId:A["2102"],debit:tax,credit:0});}
   const jv=await postEntry(scope.tx,{orgId,date,sourceType:"SALES_RETURN",sourceId:id,description:`Return credit ${number}`,userId,lines:legs});
   await db.update(customers).set({balance:sql`${customers.balance}-${total}`}).where(and(eq(customers.organizationId,orgId),eq(customers.id,inv.customerId)));
   await db.update(salesInvoices).set({balanceDue:sql`${salesInvoices.balanceDue}-${total}`}).where(eq(salesInvoices.id,inv.id));
   documents.push({type:"SALES_RETURN",id},{type:"JOURNAL",id:jv});
  }
  await db.update(marketplaceSettlementTxns).set({salesReturnId:documents.find(x=>x.type==="SALES_RETURN")!.id}).where(eq(marketplaceSettlementTxns.id,source.id));
  return {state:{...state,financial:"PARTIAL"as const},documents,sourceId:source.id};
 }
 const credit=same.find(o=>o.payload.phase==="CREDIT");
 if(!credit)throw new Error("Approve the credit note before its payout");
 if(source.status!=="Released")throw new Error("The refund is deferred; wallet settlement remains pending");
 if(source.journalEntryId)throw new Error("The refund wallet movement is already posted; link its existing document");
 const approved=credit.payload.decision as FinanceDecision;
 const approvedAllocations=approved.allocations??[{invoiceId:approved.invoiceId,lineId:approved.lineId,parts:approved.parts,quantity:approved.quantity??null}];
 if(allocationFingerprint(approvedAllocations)!==allocationFingerprint(allocations))throw new Error("Use the approved credit allocation for settlement");
 const wallet=await ensurePlatformWalletGl(orgId,"1109","محفظة أمازون");if(!wallet)throw new Error("Missing marketplace wallet");
 const legs:{accountId:string;debit:number;credit:number}[]=[];
 for(const ref of credit.documents.filter(x=>x.type==="SALES_RETURN")){
  const [ret]=await db.select().from(salesReturns).where(and(eq(salesReturns.organizationId,orgId),eq(salesReturns.id,ref.id))).limit(1);
  if(!ret||ret.status!=="POSTED"||!ret.salesInvoiceId)throw new Error("The credit document is no longer posted");
  const [inv]=await db.select().from(salesInvoices).where(and(eq(salesInvoices.organizationId,orgId),eq(salesInvoices.id,ret.salesInvoiceId))).for("update");
  if(!inv||inv.status==="CANCELLED")throw new Error("Original invoice is unavailable");
  if(Number(inv.refundedAmount)+Number(ret.totalAmount)>Number(inv.paidAmount)+0.005)throw new Error("Refund payout exceeds the original collected amount; reconcile the collection first");
  const total=Number(ret.totalAmount);legs.push({accountId:A["1103"],debit:total,credit:0});
  await db.update(customers).set({balance:sql`${customers.balance}+${total}`}).where(and(eq(customers.organizationId,orgId),eq(customers.id,inv.customerId)));
  await db.update(salesInvoices).set({balanceDue:sql`${salesInvoices.balanceDue}+${total}`,refundedAmount:sql`${salesInvoices.refundedAmount}+${total}`}).where(eq(salesInvoices.id,inv.id));
 }
 const money=(s:string)=>round(Number(s)*rate),delta=money(source.total);
 legs.push({accountId:wallet,debit:Math.max(0,delta),credit:Math.max(0,-delta)});
 fees.forEach((f,i)=>{const n=money(f);if(n){const accountId=A[["5211","5212","5213"][i]]??A["5203"];if(!accountId)throw new Error("Missing fee account");legs.push({accountId,debit:Math.max(0,-n),credit:Math.max(0,n)});}});
 const difference=round(legs.reduce((s,l)=>s+l.debit-l.credit,0));
 if(difference){
  if(source.currency===base)throw new Error("Source components require an explicit rounding-allocation review");
  const fx=await ensureFxAccounts(orgId),accountId=difference>0?fx.gain:fx.loss;if(!accountId)throw new Error("Missing exchange-difference account");legs.push({accountId,debit:Math.max(0,-difference),credit:Math.max(0,difference)});
 }
 const jv=await postEntry(scope.tx,{orgId,date,sourceType:"RETURN_REFUND_SETTLEMENT",sourceId:operationId,description:`Matched marketplace refund ${source.orderId}; ${source.id}`,userId,lines:legs});
 await db.update(marketplaceSettlementTxns).set({journalEntryId:jv}).where(eq(marketplaceSettlementTxns.id,source.id));
 documents.push({type:"JOURNAL",id:jv});
 return {state:{...state,financial:"POSTED"as const,fees:"RECONCILED"as const},documents,sourceId:source.id};
}
