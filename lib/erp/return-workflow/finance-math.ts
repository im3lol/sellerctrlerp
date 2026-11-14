import { scaled, decimal, refundAmount, type MoneyParts } from "./model";

/** Source total includes fee credits/charges. This identity must balance before
 * a refund is booked; it never treats net wallet cash as the customer's refund. */
export function refundReconciliation(parts: MoneyParts, walletDelta: string, fees: string[]) {
  const customer = scaled(refundAmount(parts));
  const returnedFees = fees.reduce((sum,v)=>sum+scaled(v),BigInt(0));
  if(scaled(walletDelta)!== -customer+returnedFees) throw new Error("Refund components do not reconcile with the source wallet movement");
  return {customer:decimal(customer),returnedFees:decimal(returnedFees),walletDelta};
}

/** JSONB reorders object keys; comparisons must use decimal values, not JSON order. */
export function allocationFingerprint(allocations:{invoiceId?:string;lineId?:string;parts:MoneyParts;quantity?:string|null}[]){
 return JSON.stringify(allocations.map(a=>({invoiceId:a.invoiceId,lineId:a.lineId,
  quantity:a.quantity==null?null:scaled(a.quantity).toString(),
  parts:[a.parts.principal,a.parts.discount,a.parts.tax,a.parts.shipping].map(v=>scaled(v).toString())
 })).sort((a,b)=>String(a.lineId).localeCompare(String(b.lineId))));
}
